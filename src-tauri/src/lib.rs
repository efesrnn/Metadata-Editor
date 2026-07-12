mod commands;
mod db;
mod grouping;
mod metadata;
mod query;
mod scanner;
mod thumbnails;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            commands::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directories,
            commands::generate_thumbs,
            commands::download_ffmpeg,
            commands::get_media,
            commands::get_stats,
            commands::check_roots,
            commands::copy_files_to_clipboard,
            commands::remove_roots,
            commands::plan_group,
            commands::plan_merge,
            commands::apply_last_plan,
            commands::ffmpeg_status,
            commands::set_media_location,
            commands::update_video_details
            ,commands::import_takeout_metadata
            ,commands::move_to_trash
            ,commands::restore_trash
            ,commands::peek_undo
            ,commands::apply_undo
        ])
        .run(tauri::generate_context!())
        .expect("SortedView başlatılamadı");
}
