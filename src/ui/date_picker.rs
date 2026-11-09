//! The original Chromium datetime popup: calendar plus independent time columns.
use super::*;
use chrono::Timelike;

fn label(ui: &egui::Ui, rect: egui::Rect, text: &str, size: f32, bold: bool, color: Color32) {
    let font = egui::FontId::new(
        size,
        egui::FontFamily::Name(if bold { "bold" } else { "regular" }.into()),
    );
    let galley = ui.fonts_mut(|fonts| fonts.layout_no_wrap(text.into(), font, color));
    ui.painter()
        .galley(rect.center() - galley.size() / 2., galley, color);
}
impl Form {
    pub(super) fn open_date_picker(&mut self) {
        let date = ["%Y-%m-%dT%H:%M", "%m/%d/%Y %I:%M %p"]
            .iter()
            .find_map(|format| chrono::NaiveDateTime::parse_from_str(&self.date, format).ok())
            .unwrap_or_else(|| local_now().naive_local());
        self.picker = date.date();
        self.picker_month = self.picker.with_day(1);
        self.picker_hour = date.hour();
        self.picker_minute = date.minute();
        self.picker_scroll = true;
        self.picker_years = false;
        self.picker_open = true;
    }
    fn commit_picker(&mut self) {
        self.date = self
            .picker
            .and_hms_opt(self.picker_hour, self.picker_minute, 0)
            .unwrap()
            .format("%m/%d/%Y %I:%M %p")
            .to_string();
        self.error = None;
    }
    pub(super) fn date_popup(&mut self, ctx: &egui::Context, anchor: egui::Rect) {
        if !self.picker_open {
            return;
        }
        let popup = egui::Rect::from_min_size(anchor.left_bottom(), egui::vec2(386., 283.));
        if ctx.input(|i| {
            i.key_pressed(egui::Key::Escape)
                || i.pointer.any_pressed()
                    && i.pointer
                        .interact_pos()
                        .is_some_and(|point| !popup.contains(point) && !anchor.contains(point))
        }) {
            self.picker_open = false;
            return;
        }
        egui::Area::new(egui::Id::new("task-datetime-picker"))
            .order(egui::Order::Foreground)
            .constrain(false)
            .fixed_pos(popup.min)
            .show(ctx, |ui| {
                ui.set_min_size(popup.size());
                ui.set_clip_rect(ctx.content_rect());
                ui.spacing_mut().item_spacing = egui::Vec2::ZERO;
                ui.painter().rect_filled(popup, 0, Color32::WHITE);
                ui.painter().vline(
                    popup.left() + 217.,
                    popup.y_range(),
                    egui::Stroke::new(1_f32, Color32::from_gray(218)),
                );
                let month = self
                    .picker_month
                    .unwrap_or(self.picker.with_day(1).unwrap());
                let caption = egui::Rect::from_min_size(
                    popup.min + egui::vec2(11., 10.),
                    egui::vec2(118., 28.),
                );
                let title = if self.picker_years {
                    month.format("%Y").to_string()
                } else {
                    month.format("%B %Y").to_string()
                };
                label(ui, caption, &title, 12., true, Color32::BLACK);
                let triangle = egui::pos2(caption.right() - 2., caption.center().y);
                ui.painter().add(egui::Shape::convex_polygon(
                    vec![
                        triangle + egui::vec2(-3., -1.),
                        triangle + egui::vec2(3., -1.),
                        triangle + egui::vec2(0., 2.),
                    ],
                    Color32::BLACK,
                    egui::Stroke::NONE,
                ));
                if ui
                    .interact(caption, ui.id().with("month-caption"), egui::Sense::click())
                    .clicked()
                {
                    self.picker_years = !self.picker_years;
                }
                for (direction, x) in [(-1, 160.), (1, 192.)] {
                    let center = popup.min + egui::vec2(x, 24.);
                    let response = ui.interact(
                        egui::Rect::from_center_size(center, egui::vec2(28., 30.)),
                        ui.id().with(("month-direction", direction)),
                        egui::Sense::click(),
                    );
                    let d = direction as f32;
                    ui.painter().line_segment(
                        [center - egui::vec2(0., 8.), center + egui::vec2(0., 8.)],
                        egui::Stroke::new(1_f32, Color32::from_gray(50)),
                    );
                    ui.painter().add(egui::Shape::line(
                        vec![
                            center + egui::vec2(-6., d * 1.),
                            center + egui::vec2(0., d * 8.),
                            center + egui::vec2(6., d * 1.),
                        ],
                        egui::Stroke::new(1_f32, Color32::from_gray(50)),
                    ));
                    if response.clicked() {
                        let amount = chrono::Months::new(if self.picker_years { 12 } else { 1 });
                        self.picker_month = if direction < 0 {
                            month.checked_sub_months(amount)
                        } else {
                            month.checked_add_months(amount)
                        };
                    }
                }
                if self.picker_years {
                    for index in 0..12 {
                        let date = month.with_month(index + 1).unwrap();
                        let rect = egui::Rect::from_min_size(
                            popup.min
                                + egui::vec2(
                                    9. + (index % 3) as f32 * 66.,
                                    51. + (index / 3) as f32 * 46.,
                                ),
                            egui::vec2(66., 42.),
                        );
                        label(
                            ui,
                            rect,
                            &date.format("%b").to_string(),
                            12.,
                            false,
                            Color32::BLACK,
                        );
                        if ui
                            .interact(
                                rect,
                                ui.id().with(("pick-month", index)),
                                egui::Sense::click(),
                            )
                            .clicked()
                        {
                            self.picker_month = Some(date);
                            self.picker_years = false;
                        }
                    }
                } else {
                    for (index, day) in ["S", "M", "T", "W", "T", "F", "S"].iter().enumerate() {
                        label(
                            ui,
                            egui::Rect::from_min_size(
                                popup.min + egui::vec2(11. + index as f32 * 28., 49.),
                                egui::vec2(28., 24.),
                            ),
                            day,
                            12.,
                            false,
                            Color32::BLACK,
                        );
                    }
                    let first = month
                        - chrono::Duration::days(month.weekday().num_days_from_sunday() as i64);
                    for index in 0..42 {
                        let day = first + chrono::Duration::days(index);
                        let rect = egui::Rect::from_min_size(
                            popup.min
                                + egui::vec2(
                                    11. + (index % 7) as f32 * 28.,
                                    74. + (index / 7) as f32 * 28.,
                                ),
                            egui::vec2(28., 28.),
                        );
                        let selected = day == self.picker;
                        let response = ui.interact(
                            rect,
                            ui.id().with(("pick-day", index)),
                            egui::Sense::click(),
                        );
                        if selected {
                            ui.painter().rect_filled(
                                rect.shrink(1.),
                                0,
                                Color32::from_rgb(0, 120, 255),
                            );
                        } else if response.hovered() {
                            ui.painter()
                                .rect_filled(rect.shrink(1.), 0, Color32::from_gray(235));
                        }
                        if day == local_now().date_naive() {
                            ui.painter().rect_stroke(
                                rect.shrink(0.5),
                                0,
                                egui::Stroke::new(2_f32, Color32::from_rgb(255, 170, 0)),
                                egui::StrokeKind::Inside,
                            );
                        }
                        label(
                            ui,
                            rect,
                            &day.day().to_string(),
                            12.,
                            selected,
                            if selected {
                                Color32::WHITE
                            } else if day.month() == month.month() {
                                Color32::BLACK
                            } else {
                                Color32::from_gray(128)
                            },
                        );
                        if response.clicked() {
                            self.picker = day;
                            self.picker_month = day.with_day(1);
                            self.commit_picker();
                        }
                    }
                }
                for (clear, x, text) in [(true, 12., "Clear"), (false, 153., "Today")] {
                    let rect = egui::Rect::from_min_size(
                        popup.min + egui::vec2(x, 247.),
                        egui::vec2(52., 30.),
                    );
                    label(ui, rect, text, 12., false, Color32::from_rgb(0, 120, 255));
                    if ui
                        .interact(
                            rect,
                            ui.id().with(("picker-footer", clear)),
                            egui::Sense::click(),
                        )
                        .clicked()
                    {
                        if clear {
                            self.date.clear();
                            self.picker_open = false;
                        } else {
                            self.picker = local_now().date_naive();
                            self.picker_month = self.picker.with_day(1);
                            self.commit_picker();
                        }
                    }
                }
                for column in 0..3 {
                    let rect = egui::Rect::from_min_size(
                        popup.min + egui::vec2(222. + column as f32 * 56., 15.),
                        egui::vec2(52., 268.),
                    );
                    let mut list = ui.new_child(
                        egui::UiBuilder::new()
                            .id_salt(("time-column", column))
                            .max_rect(rect),
                    );
                    list.set_clip_rect(rect.intersect(ctx.content_rect()));
                    let selected = match column {
                        0 => (self.picker_hour + 11) % 12,
                        1 => self.picker_minute,
                        _ => u32::from(self.picker_hour >= 12),
                    };
                    let count = match column {
                        0 => 36,
                        1 => 180,
                        _ => 2,
                    };
                    let offset = match column {
                        0 => selected + 12,
                        1 => selected + 60,
                        _ => 0,
                    };
                    let mut scroll = egui::ScrollArea::vertical()
                        .id_salt(("picker-time", column))
                        .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
                        .auto_shrink([false, false]);
                    if self.picker_scroll {
                        scroll = scroll.vertical_scroll_offset(offset as f32 * 36.);
                    }
                    scroll.show_rows(&mut list, 36., count, |ui, range| {
                        for index in range {
                            let value = match column {
                                0 => (index % 12) as u32,
                                1 => (index % 60) as u32,
                                _ => index as u32,
                            };
                            let text = match column {
                                0 => format!("{:02}", value + 1),
                                1 => format!("{value:02}"),
                                _ => if value == 0 { "AM" } else { "PM" }.into(),
                            };
                            let (row, response) =
                                ui.allocate_exact_size(egui::vec2(52., 36.), egui::Sense::click());
                            let active = value == selected;
                            if active {
                                ui.painter()
                                    .rect_filled(row, 2, Color32::from_rgb(0, 120, 255));
                            } else if response.hovered() {
                                ui.painter().rect_filled(row, 2, Color32::from_gray(235));
                            }
                            label(
                                ui,
                                row,
                                &text,
                                13.,
                                active,
                                if active {
                                    Color32::WHITE
                                } else {
                                    Color32::BLACK
                                },
                            );
                            if response.clicked() {
                                match column {
                                    0 => {
                                        self.picker_hour = (value + 1) % 12
                                            + if self.picker_hour >= 12 { 12 } else { 0 }
                                    }
                                    1 => self.picker_minute = value,
                                    _ => self.picker_hour = self.picker_hour % 12 + 12 * value,
                                }
                                self.commit_picker();
                            }
                        }
                    });
                }
                self.picker_scroll = false;
            });
    }
}
