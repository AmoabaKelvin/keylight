//! Updates from GitHub releases (the endpoint and public key are in tauri.conf.json).
//!
//! Keylight checks quietly when it starts, at most once a day, and again whenever Device asks.
//! A new version shows up on the Device page and in the menu bar menu; nothing pops up.

use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const DAY: Duration = Duration::from_secs(24 * 60 * 60);

/// The update found by the last check, ready to install.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

/// Touched after every successful check, so a launch check runs at most once a day.
fn stamp() -> std::path::PathBuf {
    crate::data_dir().join("update-checked")
}

fn checked_today() -> bool {
    std::fs::metadata(stamp()).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age < DAY)
}

fn status(app: &AppHandle) -> Value {
    let available = app.state::<Pending>().0.lock().unwrap().as_ref().map(|u| u.version.clone());
    json!({ "version": app.package_info().version.to_string(), "available": available })
}

async fn check(app: &AppHandle) -> Result<Value, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(crate::data_dir());
    let _ = std::fs::write(stamp(), "");
    let version = update.as_ref().map(|u| u.version.clone());
    *app.state::<Pending>().0.lock().unwrap() = update;
    let _ = crate::set_tray_menu(app, version.as_deref());
    let status = status(app);
    let _ = app.emit("update", &status);
    Ok(status)
}

/// At launch: check in the background unless a check already ran in the last day.
pub fn on_launch(app: &AppHandle) {
    if checked_today() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = check(&app).await {
            eprintln!("update check: {e}");
        }
    });
}

/// Downloads the pending update, swaps it in place of this app and relaunches.
pub async fn install(app: AppHandle) -> Result<(), String> {
    let update = app.state::<Pending>().0.lock().unwrap().clone().ok_or("No update to install")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart()
}

/// The running version, and the newer one found by the last check, if any.
#[tauri::command]
pub fn update_status(app: AppHandle) -> Value {
    status(&app)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Value, String> {
    check(&app).await
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    install(app).await
}
