mod commands;
mod db;
mod grouping;
mod metadata;
mod query;
mod scanner;
mod thumbnails;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            commands::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directories,
            commands::get_media,
            commands::get_stats,
            commands::plan_group,
            commands::plan_merge,
            commands::apply_last_plan,
            commands::ffmpeg_status
        ])
        .run(tauri::generate_context!())
        .expect("MetaGallery baslatilamadi");
}
