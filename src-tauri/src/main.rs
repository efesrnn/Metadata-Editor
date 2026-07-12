// Windows'ta release'de konsol penceresi acilmasin
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sortedview_lib::run()
}
