use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::webview::{DownloadEvent, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

const WINDOW_LABEL: &str = "acgrip-browser";
const HOME_URL: &str = "https://bbs.acgrip.com/";
const SEARCH_URL: &str = "https://bbs.acgrip.com/search.php";

// 用于页面检查的注入脚本
const PAGE_INSPECTION_SCRIPT: &str = r##"
(() => {
  const title = document.title || "";
  const bodyText = document.body?.textContent?.trim() || "";
  const challenge = title.includes("Just a moment")
    || title.includes("Attention Required")
    || document.querySelector("#challenge-running, .cf-challenge-running, .cf-turnstile") !== null
    || document.querySelector("script[src*=\"challenges.cloudflare.com\"], iframe[src*=\"challenges.cloudflare.com\"]") !== null;
  if (challenge || location.hostname !== "bbs.acgrip.com" || bodyText.length < 50) {
    return null;
  }

  return {
    url: location.href,
    html: document.documentElement?.outerHTML || ""
  };
})()
"##;

pub fn open_challenge_inner(app: AppHandle) -> Result<(), String> {
    let url = Url::parse(HOME_URL).map_err(|e| e.to_string())?;
    let window = ensure_window(&app, url, true)?;
    let _ = window.unminimize();
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

pub fn search_posts_inner(app: AppHandle, query: &str) -> Result<(), String> {
    let mut url = Url::parse(SEARCH_URL).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("mod", "forum")
        .append_pair("searchsubmit", "yes")
        .append_pair("srchtxt", query.trim());

    ensure_window(&app, url, false).map(|_| ())
}

pub fn get_post_inner(app: AppHandle, post_url: &str) -> Result<(), String> {
    let url = Url::parse(post_url).map_err(|e| e.to_string())?;
    ensure_window(&app, url, false).map(|_| ())
}

pub fn download_subtitle_inner(app: AppHandle, file_url: &str) -> Result<(), String> {
    let url = Url::parse(file_url).map_err(|e| e.to_string())?;
    if !url.as_str().contains("mod=attachment") {
        return Err("无效的附件地址".to_string());
    }
    ensure_window(&app, url, false).map(|_| ())
}

// 创建或复用 webview
fn ensure_window(
    app: &AppHandle,
    initial_url: Url,
    visible: bool,
) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if visible {
            window.show().map_err(|e| e.to_string())?;
        } else {
            let _ = window.hide();
        }
        window.navigate(initial_url).map_err(|e| e.to_string())?;
        return Ok(window);
    }

    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser");
    std::fs::create_dir_all(&data_directory).map_err(|e| e.to_string())?;

    let pending_downloads = Arc::new(Mutex::new(HashMap::<String, PathBuf>::new()));
    let downloads_for_handler = Arc::clone(&pending_downloads);
    let app_for_downloads = app.clone();
    let app_for_pages = app.clone();

    WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(initial_url))
        .title("CF过盾小助手")
        .min_inner_size(800.0, 600.0)
        .center()
        .focused(visible)
        .visible(visible)
        .data_directory(data_directory)
        .enable_clipboard_access()
        .on_navigation(|_| true)
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }

            let browser = window.clone();
            let app = app_for_pages.clone();
            let _ = window.eval_with_callback(PAGE_INSPECTION_SCRIPT, move |raw| {
                let payload = serde_json::from_str::<Value>(&raw)
                    .and_then(|value| match value {
                        Value::String(inner) => serde_json::from_str(&inner),
                        value => Ok(value),
                    })
                    .ok();
                let Some(payload) = payload else {
                    let _ = app.emit("session-verified", false);
                    return;
                };

                let verified = payload.is_object();
                let _ = app.emit("session-verified", verified);
                if !verified {
                    return;
                }

                let _ = browser.hide();
                let _ = app.emit("browser-page", &payload);
            });
        })
        .on_download(move |_, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let Ok(path) = resolve_download_path(&app_for_downloads, destination) else {
                        return true;
                    };

                    *destination = path.clone();
                    if let Ok(mut downloads) = downloads_for_handler.lock() {
                        downloads.insert(url.to_string(), path);
                    }
                }
                DownloadEvent::Finished { url, path, success } => {
                    let remembered_path = downloads_for_handler
                        .lock()
                        .ok()
                        .and_then(|mut downloads| downloads.remove(url.as_str()));

                    if !success {
                        return true;
                    }

                    if let Some(path) = path.or(remembered_path) {
                        let _ = app_for_downloads
                            .emit("download-finished", path.to_string_lossy());
                    }
                }
                _ => {}
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())
}

// 生成下载路径，并在重名时追加序号
fn resolve_download_path(app: &AppHandle, proposed: &Path) -> Result<PathBuf, String> {
    let downloads = app
        .store("config.json")
        .ok()
        .and_then(|store| store.get("download"))
        .and_then(|download| {
            download
                .get("directory")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|directory| !directory.is_empty())
                .map(PathBuf::from)
        })
        .map(Ok)
        .unwrap_or_else(|| {
            app.path()
                .app_config_dir()
                .map(|directory| directory.join("cache"))
        })
        .map_err(|e| e.to_string())?;

    std::fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;

    let file_name = proposed
        .file_name()
        .unwrap_or_else(|| OsStr::new("subtitle_file"));
    let candidate = downloads.join(file_name);

    if !candidate.exists() {
        return Ok(candidate);
    }

    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("subtitle_file")
        .to_string();
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| format!(".{extension}"))
        .unwrap_or_default();

    let mut index = 1;
    loop {
        let candidate = downloads.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
        index += 1;
    }
}
