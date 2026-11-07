//! Keylight: lights, shapes and keys for the NuPhy Air75 V3.
//!
//! The app owns the keyboard connection itself (engine + hid), keeps running in the menu bar, and
//! listens on a local socket so Karabiner can tell it when Hyper is held (`keylight hyper on`).

mod caps;
mod engine;
mod hid;
mod karabiner;
mod server;
mod update;

use engine::{Engine, Shared};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// Settings and the socket. Short on purpose: socket paths are limited to 104 bytes.
pub fn data_dir() -> PathBuf {
    home().join("Library/Application Support/Keylight")
}

/// The executable Karabiner should call: the installed app's, wherever it lives.
fn bin_path() -> String {
    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_else(|_| "/Applications/Keylight.app/Contents/MacOS/keylight".into())
}

/// Command-line mode: `keylight hyper on|off`, `keylight caps-toggle`, `keylight send '{json}'`.
/// Returns an exit code when the arguments were a command, None to start the app.
pub fn cli(args: &[String]) -> Option<i32> {
    let msg = match args.first().map(String::as_str)? {
        "hyper" => json!({ "op": "hyper", "on": args.get(1).map(String::as_str) == Some("on") }).to_string(),
        "send" => args.get(1).cloned().unwrap_or_default(),
        "caps-toggle" => {
            return Some(match caps::toggle() {
                Ok(_) => 0,
                Err(e) => {
                    eprintln!("{e}");
                    1
                }
            });
        }
        "setup-karabiner" => {
            let bin = bin_path();
            return Some(match karabiner::repoint(&bin).and_then(|n| Ok((n, karabiner::install(&bin)?))) {
                Ok((n, added)) => {
                    println!("repointed {n} command(s); added {} rule(s){}", added.len(), if added.is_empty() { String::new() } else { format!(": {}", added.join(", ")) });
                    0
                }
                Err(e) => {
                    eprintln!("{e}");
                    1
                }
            });
        }
        "help" | "--help" | "-h" => {
            println!("keylight [hyper on|off | caps-toggle | setup-karabiner | send '<json>']  (no arguments: open the app)");
            return Some(0);
        }
        _ => return None,
    };
    match server::send(&server::socket_path(), &msg) {
        Ok(reply) => {
            if reply != "ok" {
                println!("{reply}");
            }
            Some(if reply.starts_with("error") { 1 } else { 0 })
        }
        Err(e) => {
            eprintln!("{e}");
            1.into()
        }
    }
}

struct AppState {
    engine: Shared,
}

#[tauri::command]
async fn daemon(state: tauri::State<'_, AppState>, msg: Value) -> Result<Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.lock().unwrap().handle(&msg)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn karabiner_rules() -> Result<Value, String> {
    karabiner::rules(&bin_path())
}

#[tauri::command]
fn karabiner_set(description: String, enabled: bool) -> Result<(), String> {
    karabiner::set_enabled(&description, enabled)
}

/// Adds Keylight's rules (Hyper, Caps Lock as Control, both Shifts) and points old ones at this app.
#[tauri::command]
fn karabiner_install() -> Result<Vec<String>, String> {
    let bin = bin_path();
    karabiner::repoint(&bin)?;
    karabiner::install(&bin)
}

#[tauri::command]
fn open_karabiner() -> Result<(), String> {
    let installed = std::path::Path::new("/Applications/Karabiner-Elements.app").exists();
    let target = if installed { "/Applications/Karabiner-Elements.app" } else { "https://karabiner-elements.pqrs.org" };
    Command::new("open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn autostart(app: AppHandle, on: Option<bool>) -> Result<bool, String> {
    let launcher = app.autolaunch();
    match on {
        Some(true) => launcher.enable().map_err(|e| e.to_string())?,
        Some(false) => launcher.disable().map_err(|e| e.to_string())?,
        None => {}
    }
    launcher.is_enabled().map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The menu bar menu: quick themes without opening the window, and a new version when there is one.
fn tray_menu(app: &AppHandle, update: Option<&str>) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("open", "Open Keylight")?,
            &PredefinedMenuItem::separator(app)?,
            &item("theme:warm", "Warm")?,
            &item("theme:stripes", "Stripes")?,
            &item("theme:rainbow", "Rainbow")?,
            &item("theme:wave", "Wave")?,
            &item("theme:off", "Lights off")?,
            &PredefinedMenuItem::separator(app)?,
        ],
    )?;
    if let Some(version) = update {
        menu.append(&item("update", &format!("Update to {version} and restart"))?)?;
    }
    menu.append(&item("quit", "Quit Keylight")?)?;
    Ok(menu)
}

/// Rebuilds the menu bar menu, with or without the update item.
pub(crate) fn set_tray_menu(app: &AppHandle, update: Option<&str>) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("keylight") {
        tray.set_menu(Some(tray_menu(app, update)?))?;
    }
    Ok(())
}

fn tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app, None)?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("keylight")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Keylight")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let msg = match event.id().as_ref() {
                "open" => return show_main(app),
                "quit" => return app.exit(0),
                "update" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = update::install(app).await {
                            eprintln!("update: {e}");
                        }
                    });
                    return;
                }
                "theme:warm" => json!({ "op": "base", "name": "solid", "color": [255, 170, 110], "level": 100 }),
                "theme:stripes" => json!({ "op": "base", "name": "stripes", "level": 100 }),
                "theme:rainbow" => json!({ "op": "base", "name": "rainbow", "level": 100 }),
                "theme:wave" => json!({ "op": "base", "name": "effect", "mode": 6, "speed": 2, "direction": 0, "rgb": true, "level": 100 }),
                "theme:off" => json!({ "op": "base", "name": "off" }),
                _ => return,
            };
            let engine = app.state::<AppState>().engine.clone();
            std::thread::spawn(move || {
                let _ = engine.lock().unwrap().handle(&msg);
            });
        })
        .build(app)?;
    Ok(())
}

/// First run: bring over settings from nuphyd (the script Keylight grew out of), if there are any.
fn state_path() -> PathBuf {
    let path = data_dir().join("state.json");
    let old = home().join(".local/state/nuphy/state.json");
    if !path.exists() && old.exists() {
        let _ = std::fs::create_dir_all(data_dir());
        let _ = std::fs::copy(&old, &path);
    }
    path
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let first_run = !data_dir().join("state.json").exists() && !home().join(".local/state/nuphy/state.json").exists();
    let engine: Shared = Arc::new(Mutex::new(Engine::new(state_path())));
    engine.lock().unwrap().flush();
    server::serve(engine.clone());
    {
        let engine = engine.clone();
        std::thread::spawn(move || {
            let mut n: u64 = 0;
            loop {
                std::thread::sleep(Duration::from_millis(250));
                n += 1;
                engine.lock().unwrap().tick(n);
            }
        });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState { engine })
        .manage(update::Pending::default())
        .setup(move |app| {
            tray(app.handle())?;
            // A menu bar utility should be there after a restart; it can be turned off in Device.
            if first_run {
                let _ = app.autolaunch().enable();
            }
            update::on_launch(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps Keylight in the menu bar, still driving the lights.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![daemon, karabiner_rules, karabiner_set, karabiner_install, open_karabiner, autostart, update::update_status, update::update_check, update::update_install])
        .build(tauri::generate_context!())
        .expect("error while building Keylight")
        .run(|app, event| {
            if let RunEvent::Reopen { .. } = event {
                show_main(app);
            }
        });
}
