use super::*;
fn icon(index: usize) -> egui::ImageSource<'static> {
    match index {
        0 => egui::include_image!("../../assets/icons/ai-chat.svg"),
        1 => egui::include_image!("../../assets/icons/calendar.svg"),
        2 => egui::include_image!("../../assets/icons/up-next.svg"),
        3 => egui::include_image!("../../assets/icons/tasks.svg"),
        4 => egui::include_image!("../../assets/icons/updates.svg"),
        _ => egui::include_image!("../../assets/icons/settings.svg"),
    }
}
fn pill(ui: &mut egui::Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(
            RichText::new(label)
                .family(egui::FontFamily::Name("semibold".into()))
                .color(ui.visuals().selection.stroke.color),
        )
        .fill(ui.visuals().selection.bg_fill)
        .corner_radius(100),
    )
}
fn deletion_ease(t: f32) -> f32 {
    let (mut lo, mut hi) = (0_f32, 1_f32);
    for _ in 0..12 {
        let u = (lo + hi) * 0.5;
        let x = 3. * (1. - u).powi(2) * u * 0.4 + 3. * (1. - u) * u * u * 0.2 + u * u * u;
        if x < t { lo = u } else { hi = u }
    }
    let u = (lo + hi) * 0.5;
    3. * u * u - 2. * u * u * u
}
fn text_galley(
    ui: &egui::Ui,
    text: &str,
    size: f32,
    line_height: f32,
    weight: &str,
    width: f32,
    rows: usize,
    color: Color32,
    strike: bool,
) -> Arc<egui::Galley> {
    let mut job = egui::text::LayoutJob::simple(
        text.split_ascii_whitespace().collect::<Vec<_>>().join(" "),
        egui::FontId::new(size, egui::FontFamily::Name(weight.into())),
        color,
        width.max(1.),
    );
    job.wrap.max_rows = rows;
    job.wrap.break_anywhere = rows == 1;
    job.wrap.overflow_character = Some('…');
    job.sections[0].format.line_height = Some(line_height);
    if strike {
        job.sections[0].format.strikethrough = egui::Stroke::new(1_f32, color);
    }
    ui.fonts_mut(|fonts| fonts.layout_job(job))
}
fn paint_text(
    ui: &egui::Ui,
    position: egui::Pos2,
    text: &str,
    size: f32,
    line: f32,
    weight: &str,
    width: f32,
    color: Color32,
) -> egui::Vec2 {
    let galley = text_galley(
        ui,
        text,
        size,
        line,
        weight,
        width,
        usize::MAX,
        color,
        false,
    );
    let size = galley.size();
    ui.painter().galley(position, galley, color);
    size
}
fn gradient_pill(ui: &egui::Ui, rect: egui::Rect) {
    let colors = [
        [0_f32, 122., 255.],
        [52., 199., 89.],
        [0., 199., 186.],
        [0., 122., 255.],
    ];
    let phase = (ui.input(|i| i.time) as f32 * std::f32::consts::TAU / 8.).sin() * 0.5 + 0.5;
    let color = |point: egui::Pos2| {
        let value = (((point.x - rect.left()) / rect.width()
            + (point.y - rect.top()) / rect.height())
            / 6.
            + phase * 0.66)
            .clamp(0., 0.999)
            * 3.;
        let index = value.floor() as usize;
        let t = value.fract();
        let a = colors[index];
        let b = colors[index + 1];
        Color32::from_rgb(
            (a[0] + (b[0] - a[0]) * t) as u8,
            (a[1] + (b[1] - a[1]) * t) as u8,
            (a[2] + (b[2] - a[2]) * t) as u8,
        )
    };
    let mut mesh = egui::Mesh::default();
    let center = rect.center();
    let radius = rect.width() / 2.;
    mesh.vertices.push(egui::epaint::Vertex {
        pos: center,
        uv: egui::epaint::WHITE_UV,
        color: color(center),
    });
    for i in 0..=64 {
        let angle = i as f32 * std::f32::consts::TAU / 64.;
        let unit = egui::vec2(angle.cos(), angle.sin());
        let pos = center + unit * (radius - 0.5);
        mesh.vertices.push(egui::epaint::Vertex {
            pos,
            uv: egui::epaint::WHITE_UV,
            color: color(pos),
        });
        mesh.vertices.push(egui::epaint::Vertex {
            pos: center + unit * (radius + 0.5),
            uv: egui::epaint::WHITE_UV,
            color: Color32::TRANSPARENT,
        });
    }
    for i in 0..64_u32 {
        let a = 1 + i * 2;
        let b = a + 2;
        mesh.add_triangle(0, a, b);
        mesh.add_triangle(a, a + 1, b);
        mesh.add_triangle(a + 1, b + 1, b);
    }
    ui.painter().add(mesh);
    ui.ctx().request_repaint();
}
impl App {
    pub(super) fn header(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let compact = ui.available_width() < 310.;
        let size = if compact { 26. } else { 32. };
        let gap = if compact { 4. } else { 8. };
        let (rect, _) = ui.allocate_exact_size(
            egui::vec2(ui.available_width(), if compact { 26. } else { 32. }),
            egui::Sense::hover(),
        );
        let drag = ui.interact(rect, ui.id().with("window-drag"), egui::Sense::drag());
        if drag.drag_started() && !self.hosted {
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::StartDrag);
        }
        let start = rect.min + egui::vec2(if compact { 0. } else { 4. }, -4.);
        let animated =
            ui.ctx()
                .animate_value_with_time(egui::Id::new("tab-position"), self.tab as f32, 0.3);
        ui.painter().rect_filled(
            egui::Rect::from_min_size(
                start + egui::vec2(animated * (size + gap), 0.),
                egui::vec2(size, size),
            ),
            size / 2.,
            if self.tab == 0 { p.primary } else { p.success },
        );
        if self.tab == 0 && !self.hosted {
            gradient_pill(
                ui,
                egui::Rect::from_min_size(
                    start + egui::vec2(animated * (size + gap), 0.),
                    egui::vec2(size, size),
                ),
            );
        }
        for (index, label) in TABS.iter().enumerate() {
            let button = egui::Rect::from_min_size(
                start + egui::vec2(index as f32 * (size + gap), 0.),
                egui::vec2(size, size),
            );
            let image = egui::Image::new(icon(index))
                .fit_to_exact_size(egui::vec2(16., 16.))
                .tint(if self.tab == index {
                    if index == 0 { p.text } else { p.on_primary }
                } else {
                    p.muted
                });
            let response = ui
                .put(button, egui::Button::image(image).frame(false))
                .on_hover_text(*label);
            if response.clicked() {
                self.switch_tab(index);
            }
        }
        if !self.hosted {
            let close = egui::Rect::from_min_size(
                egui::pos2(rect.right() - 28., rect.top()),
                egui::vec2(24., 24.),
            );
            let response = ui
                .interact(close, ui.id().with("close"), egui::Sense::click())
                .on_hover_text("Close application");
            if response.hovered() {
                ui.painter().circle_filled(close.center(), 12., p.error);
            }
            egui::Image::new(egui::include_image!("../../assets/icons/close-tab.svg"))
                .tint(if response.hovered() {
                    p.on_primary
                } else {
                    p.muted
                })
                .paint_at(
                    ui,
                    egui::Rect::from_center_size(close.center(), egui::vec2(14., 14.)),
                );
            if response.clicked() {
                ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
        ui.advance_cursor_after_rect(rect);
    }
    fn card_foreground(&self, ui: &mut egui::Ui, item: &Item) -> (egui::Rect, Option<egui::Rect>) {
        let p = self.palette();
        let linux = cfg!(target_os = "linux");
        let compact = self.settings.size == "Small";
        let scale = if linux {
            self.settings.text_scale()
        } else {
            1.
        };
        let metadata = if linux {
            12.
        } else if compact {
            9.
        } else {
            11.
        };
        let title_size = if linux { 16. } else { 14. };
        let (px, py, radius) = if compact {
            (10., 8., 10)
        } else {
            (12., 10., 14)
        };
        let start = ui.next_widget_position();
        let width = ui.available_width();
        let inner = width - 2. * px;
        let color = if item.completed { p.on_primary } else { p.text };
        let faded = |color: Color32, opacity: f32| {
            if item.completed {
                color.gamma_multiply(opacity)
            } else {
                color
            }
        };
        let now = local_now().fixed_offset();
        let deadline = item.kind == "deadline";
        let time = if deadline || item.zoom_link.is_some() {
            view::primary_time_label(item, now)
        } else {
            item.timestamp()
                .map(|date| {
                    let date = date.with_timezone(&Local);
                    if date.date_naive() == local_now().date_naive() {
                        date.format("%I:%M %p").to_string()
                    } else {
                        date.format("%-m/%-d").to_string()
                    }
                })
                .unwrap_or_default()
        };
        let time_color = if item.completed {
            p.on_primary
        } else if deadline && (view::urgent(item, now) || item.timestamp().is_some_and(|d| d < now))
        {
            p.error
        } else if deadline || item.zoom_link.is_some() {
            p.primary
        } else {
            p.muted
        };
        let time = text_galley(
            ui,
            &time,
            metadata * scale,
            metadata * 1.4 * scale,
            "semibold",
            inner,
            1,
            time_color,
            false,
        );
        let course = item.course.split(" - ").next().unwrap_or("");
        let mut blocks: Vec<(egui::Pos2, Arc<egui::Galley>, Color32)> = Vec::new();
        let mut zoom = None;
        let mut estimate_icon = None;
        let height;
        if item.zoom_link.is_some() {
            let course_color = faded(color, 0.7);
            let course = text_galley(
                ui,
                course,
                title_size * scale,
                title_size * if linux { 1.35 } else { 18. / 14. } * scale,
                "semibold",
                inner - 28. - 8. - time.size().x - 4.,
                usize::MAX,
                course_color,
                item.completed,
            );
            let course_height = course.rows.len() as f32
                * title_size
                * if linux { 1.35 } else { 18. / 14. }
                * scale;
            let row = course_height.max(28.).max(metadata * 1.4 * scale);
            zoom = Some(egui::Rect::from_min_size(
                start + egui::vec2(px, py + (row - 28.) / 2.),
                egui::vec2(28., 28.),
            ));
            blocks.push((
                start + egui::vec2(px + 36., py + (row - course_height) / 2.),
                course,
                course_color,
            ));
            blocks.push((
                start + egui::vec2(width - px - time.size().x, py + (row - time.size().y) / 2.),
                time,
                time_color,
            ));
            height = row + py * 2.;
        } else {
            let course_color = if item.completed {
                p.on_primary.gamma_multiply(0.8)
            } else {
                p.muted
            };
            let course = text_galley(
                ui,
                course,
                metadata * scale,
                metadata * 1.4 * scale,
                "medium",
                inner - time.size().x - 8.,
                1,
                course_color,
                false,
            );
            let row = metadata * 1.4 * scale;
            blocks.push((start + egui::vec2(px, py), course, course_color));
            blocks.push((
                start + egui::vec2(width - px - time.size().x, py),
                time,
                time_color,
            ));
            let title_color = faded(color, 0.7);
            let title = text_galley(
                ui,
                &item.title,
                title_size * scale,
                title_size * if linux { 1.35 } else { 18. / 14. } * scale,
                if self.hosted { "bold" } else { "semibold" },
                inner,
                2,
                title_color,
                item.completed,
            );
            let mut y = py + row + 4. + 2.;
            let title_height =
                title.rows.len() as f32 * title_size * if linux { 1.35 } else { 18. / 14. } * scale;
            blocks.push((start + egui::vec2(px, y), title, title_color));
            y += title_height + 2.;
            if !compact {
                if deadline {
                    if let Some(estimate) = &item.time_estimate {
                        y += 8.;
                        let estimate_color = if item.completed {
                            p.on_primary.gamma_multiply(0.8)
                        } else {
                            p.muted
                        };
                        let estimate = text_galley(
                            ui,
                            estimate,
                            metadata * scale,
                            metadata * 1.4 * scale,
                            "medium",
                            inner - 16.,
                            1,
                            estimate_color,
                            false,
                        );
                        let h = metadata * 1.4 * scale;
                        // The original estimate glyph is a 12px outlined circle, centered at (4.5,5.9).
                        let center = start + egui::vec2(px + 4.5, y + h / 2.);
                        estimate_icon = Some((center, estimate_color));
                        blocks.push((start + egui::vec2(px + 16., y), estimate, estimate_color));
                        y += h;
                    }
                }
                if matches!(item.kind.as_str(), "announcement" | "comment") {
                    if let Some(preview) = &item.preview {
                        y += 8.;
                        let preview = text_galley(
                            ui,
                            preview,
                            if linux { 14. * scale } else { 12. },
                            if linux { 19.6 * scale } else { 16. },
                            "regular",
                            inner,
                            2,
                            p.muted,
                            false,
                        );
                        let h = preview.size().y;
                        blocks.push((start + egui::vec2(px, y), preview, p.muted));
                        y += h;
                    }
                    if let Some(author) = &item.author {
                        y += 8.;
                        let color = p.primary.gamma_multiply(0.8);
                        let author = text_galley(
                            ui,
                            &format!("By: {author}"),
                            metadata * scale,
                            metadata * 1.4 * scale,
                            "medium",
                            inner,
                            usize::MAX,
                            color,
                            false,
                        );
                        let h = author.size().y;
                        blocks.push((start + egui::vec2(px, y), author, color));
                        y += h;
                    }
                }
            }
            height = y + py;
        }
        let rect = egui::Rect::from_min_size(start, egui::vec2(width, height));
        ui.painter().rect_filled(
            rect,
            radius,
            if item.completed { p.success } else { p.card },
        );
        if let Some((center, color)) = estimate_icon {
            ui.painter()
                .circle_stroke(center, 1.75, egui::Stroke::new(0.75_f32, color));
        }
        if let Some(rect) = zoom {
            ui.painter().circle_filled(rect.center(), 14., p.primary);
            egui::Image::new(egui::include_image!("../../assets/icons/zoom.svg"))
                .fit_to_exact_size(egui::vec2(16., 16.))
                .paint_at(
                    ui,
                    egui::Rect::from_center_size(rect.center(), egui::vec2(16., 16.)),
                );
        }
        for (position, galley, color) in blocks {
            ui.painter().galley(position, galley, color);
        }
        (rect, zoom)
    }
    pub(super) fn auth(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let rect = ui.ctx().content_rect();
        let scale = match self.settings.size.as_str() {
            "Small" => 0.85,
            "Large" => 1.25,
            _ => 1.,
        };
        let text = if cfg!(target_os = "linux") {
            self.settings.text_scale()
        } else {
            1.
        };
        let title = if cfg!(target_os = "linux") { 16. } else { 14. } * scale * text;
        let label = if cfg!(target_os = "linux") { 13. } else { 12. } * scale * text;
        let success = self.auth_success.is_some();
        let width = rect.width() - 24. * scale;
        let error = self.error.as_ref().map(|message| {
            text_galley(
                ui,
                message,
                label,
                label * 1.4,
                "medium",
                width,
                usize::MAX,
                p.error,
                false,
            )
        });
        let error_height = error
            .as_ref()
            .map(|text| text.rows.len() as f32 * label * 1.4 + 8. * scale)
            .unwrap_or(0.);
        let input_height = label * 1.4 + 24. * scale;
        let button_height = label * 1.4 + 16. * scale;
        let height = 32. * scale
            + 4. * scale
            + title * 1.35
            + 20. * scale
            + if success {
                label * 1.4
            } else {
                input_height + 8. * scale + button_height + error_height
            };
        let mut y = (rect.center().y - height / 2.).max(48. * scale);
        let logo = egui::Rect::from_center_size(
            egui::pos2(rect.center().x, y + 16. * scale),
            egui::vec2(32. * scale, 32. * scale),
        );
        egui::Image::new(egui::include_image!("../../assets/icons/auth.svg"))
            .tint(p.primary)
            .paint_at(ui, logo);
        y += 36. * scale;
        let title_galley = text_galley(
            ui,
            "Connect to Canvas",
            title,
            title * 1.35,
            "semibold",
            width,
            1,
            p.text,
            false,
        );
        ui.painter().galley(
            egui::pos2(rect.center().x - title_galley.size().x / 2., y),
            title_galley,
            p.text,
        );
        y += title * 1.35 + 20. * scale;
        if success {
            let text = text_galley(
                ui,
                "Authenticated Successfully!",
                label,
                label * 1.4,
                "medium",
                width,
                1,
                p.primary,
                false,
            );
            ui.painter().galley(
                egui::pos2(rect.center().x - text.size().x / 2., y),
                text,
                p.primary,
            );
        } else {
            let input = egui::Rect::from_min_size(
                egui::pos2(rect.center().x - width / 3., y),
                egui::vec2(width * 2. / 3., input_height),
            );
            ui.painter().rect(
                input,
                100,
                p.card,
                egui::Stroke::new(if self.error.is_some() { 2_f32 } else { 0. }, p.error),
                egui::StrokeKind::Inside,
            );
            let response = ui.put(
                input,
                egui::TextEdit::singleline(&mut self.auth_url)
                    .interactive(!self.auth_waiting)
                    .frame(false)
                    .hint_text(RichText::new("canvas.edu").color(p.muted))
                    .font(egui::FontId::new(
                        label,
                        egui::FontFamily::Name("medium".into()),
                    ))
                    .horizontal_align(egui::Align::Center)
                    .margin(egui::vec2(10. * scale, 10. * scale)),
            );
            if response.changed() {
                self.error = None;
            }
            y += input_height + 8. * scale;
            if let Some(error) = error {
                let height = error.rows.len() as f32 * label * 1.4;
                ui.painter().galley(
                    egui::pos2(rect.center().x - error.size().x / 2., y),
                    error,
                    p.error,
                );
                y += height + 8. * scale;
            }
            let button = egui::Rect::from_min_size(
                egui::pos2(rect.center().x - width * 0.144, y),
                egui::vec2(width * 0.288, button_height),
            );
            let enabled = !self.auth_waiting && !self.auth_url.is_empty();
            let mut painter = ui.painter().clone();
            if !enabled {
                painter.set_opacity(0.7);
            }
            painter.rect_filled(button, 100, p.success);
            let text = text_galley(
                ui,
                if self.auth_waiting {
                    "Waiting..."
                } else {
                    "Log in"
                },
                label,
                label * 1.4,
                "semibold",
                button.width() - 8. * scale,
                1,
                p.on_primary,
                false,
            );
            painter.galley(button.center() - text.size() / 2., text, p.on_primary);
            let clicked = ui
                .interact(button, ui.id().with("login"), egui::Sense::click())
                .clicked();
            if enabled
                && (clicked
                    || (response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter))))
            {
                self.login();
            }
        }
        if !self.hosted {
            let close = egui::Rect::from_min_size(
                rect.right_top() + egui::vec2(-36. * scale, 12. * scale),
                egui::vec2(24. * scale, 24. * scale),
            );
            let response = ui
                .interact(close, ui.id().with("auth-close"), egui::Sense::click())
                .on_hover_text("Close Canvas Sidekick");
            if response.hovered() {
                ui.painter()
                    .circle_filled(close.center(), 12. * scale, p.error);
            }
            egui::Image::new(egui::include_image!("../../assets/icons/close.svg"))
                .tint(if response.hovered() {
                    p.on_primary
                } else {
                    p.muted
                })
                .paint_at(
                    ui,
                    egui::Rect::from_center_size(
                        close.center(),
                        egui::vec2(14. * scale, 14. * scale),
                    ),
                );
            if response.clicked() {
                ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
    }
    pub(super) fn card(&mut self, ui: &mut egui::Ui, item: &Item) {
        let is_deadline = item.kind == "deadline";
        let mut state = self.card_states.remove(&item.id).unwrap_or_default();
        let start = ui.next_widget_position();
        let width = ui.available_width();
        let progress = state
            .deleting
            .map(|when| (when.elapsed().as_secs_f32() / 0.3).clamp(0., 1.))
            .unwrap_or(0.);
        let progress = deletion_ease(progress);
        let reveal = ui.ctx().animate_bool_with_time(
            egui::Id::new(("reveal", &item.id)),
            state.revealed,
            0.2,
        );
        let offset = if state.dragging {
            state.offset
        } else {
            -64. * reveal
        };
        let mut slot = egui::Rect::from_min_size(start, egui::vec2(width, state.height.max(48.)));
        if item.is_custom && (state.revealed || state.dragging || reveal > 0.) {
            let action = egui::Rect::from_min_size(
                egui::pos2(slot.right() - 57. - width * progress, slot.top() + 4.),
                egui::vec2(44., (slot.height() - 8.).max(1.)),
            );
            let mut action_ui = ui.new_child(
                egui::UiBuilder::new()
                    .id_salt(("delete", &item.id))
                    .max_rect(action),
            );
            action_ui.set_opacity(1. - progress);
            let response = action_ui
                .put(
                    action,
                    egui::Button::image(
                        egui::Image::new(egui::include_image!("../../assets/icons/trash.svg"))
                            .fit_to_exact_size(egui::vec2(20., 20.)),
                    )
                    .fill(Color32::from_rgb(255, 59, 48))
                    .corner_radius(12),
                )
                .on_hover_text("Delete task");
            if response.clicked() && state.deleting.is_none() {
                state.click = None;
                state.deleting = Some(Instant::now());
            }
        }
        let mut card_ui =
            ui.new_child(egui::UiBuilder::new().id_salt(("card", &item.id)).max_rect(
                egui::Rect::from_min_size(
                    start + egui::vec2(offset - width * progress, 0.),
                    egui::vec2(width, f32::INFINITY),
                ),
            ));
        if state.deleting.is_some() {
            card_ui.set_opacity(1. - progress);
            card_ui.disable();
        }
        let (frame_rect, zoom_rect) = self.card_foreground(&mut card_ui, item);

        state.height = frame_rect.height();
        let height = if item.is_custom {
            state.height.min(150. * (1. - progress))
        } else {
            state.height
        };
        slot.set_height(height.max(0.));
        ui.advance_cursor_after_rect(slot);
        let response = ui.interact(
            frame_rect,
            ui.id().with(("card-click", &item.id)),
            if item.is_custom {
                egui::Sense::click_and_drag()
            } else {
                egui::Sense::click()
            },
        );
        let open_zoom = zoom_rect.is_some_and(|rect| {
            ui.interact(rect, ui.id().with(("zoom", &item.id)), egui::Sense::click())
                .clicked()
        });
        if open_zoom {
            if let Some(url) = &item.zoom_link {
                open_external(url);
            }
        } else if item.is_custom {
            if response.drag_started() {
                state.dragging = true;
                state.offset = if state.revealed { -64. } else { 0. };
                state.click = None;
            }
            if response.dragged() {
                state.offset = (state.offset + response.drag_delta().x).clamp(-100., 0.);
            }
            if response.drag_stopped() {
                state.dragging = false;
                state.revealed = state.offset < -50.;
            }
            if response.double_clicked() {
                state.click = None;
                state.revealed = !state.revealed;
                state.offset = if state.revealed { -64. } else { 0. };
            } else if response.clicked() {
                if state.revealed || is_deadline {
                    state.click = Some(Instant::now() + Duration::from_millis(200));
                }
            }
        } else if response.clicked() && is_deadline {
            self.toggle(&item.id);
        }
        self.card_states.insert(item.id.clone(), state);
        ui.add_space(-4.);
    }
    pub(super) fn agenda(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let mut items = view::filtered(
            &self.state.items,
            TABS[self.tab],
            &self.courses,
            local_now().fixed_offset(),
        );
        if self.tab == 4 {
            let mut courses: Vec<_> = items
                .iter()
                .filter(|i| !i.course.is_empty())
                .map(|i| i.course.split(" - ").next().unwrap_or("").to_owned())
                .collect();
            courses.sort();
            courses.dedup();
            if !courses.is_empty() {
                egui::ScrollArea::horizontal()
                    .id_salt("update-courses")
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 6.;
                            for course in std::iter::once("All".to_owned()).chain(courses) {
                                let selected = self.update_course == course;
                                let scale = if cfg!(target_os = "linux") {
                                    self.settings.text_scale()
                                } else {
                                    1.
                                };
                                let font = if cfg!(target_os = "linux") {
                                    12. * scale
                                } else if self.settings.size == "Small" {
                                    8.
                                } else {
                                    11.
                                };
                                let line = font * 1.4;
                                let color = if selected {
                                    p.on_primary
                                } else if self.hosted {
                                    p.muted
                                } else {
                                    Color32::from_rgb(204, 194, 220)
                                };
                                let text = text_galley(
                                    ui,
                                    &course,
                                    font,
                                    line,
                                    if selected { "bold" } else { "regular" },
                                    f32::INFINITY,
                                    1,
                                    color,
                                    false,
                                );
                                let compact = self.settings.size == "Small";
                                let padding = if compact {
                                    egui::vec2(16., 8.)
                                } else {
                                    egui::vec2(24., 12.)
                                };
                                let size = egui::vec2(text.size().x, line)
                                    + padding
                                    + egui::Vec2::splat(if selected { 0. } else { 2. });
                                let (rect, response) =
                                    ui.allocate_exact_size(size, egui::Sense::click());
                                ui.painter().rect(
                                    rect,
                                    100,
                                    if selected { p.success } else { p.card },
                                    egui::Stroke::new(if selected { 0_f32 } else { 1. }, p.outline),
                                    egui::StrokeKind::Inside,
                                );
                                ui.painter()
                                    .galley(rect.center() - text.size() / 2., text, color);
                                if response.clicked() {
                                    self.update_course = course;
                                }
                            }
                        });
                    });
                ui.add_space(0.);
            }
            items.retain(|i| {
                self.update_course == "All" || i.course.starts_with(&self.update_course)
            });
            items.sort_by_key(|i| std::cmp::Reverse(i.timestamp()));
        }
        if self.loading {
            for _ in 0..4 {
                let (rect, _) = ui.allocate_exact_size(
                    egui::vec2(ui.available_width(), 84.),
                    egui::Sense::hover(),
                );
                ui.painter().rect_filled(rect, 14, p.card);
                let inner = rect.shrink2(egui::vec2(12., 10.));
                for block in [
                    egui::Rect::from_min_size(inner.min, egui::vec2(inner.width() * 0.4, 14.)),
                    egui::Rect::from_min_size(
                        inner.right_top() - egui::vec2(inner.width() * 0.2, 0.),
                        egui::vec2(inner.width() * 0.2, 14.),
                    ),
                    egui::Rect::from_min_size(
                        inner.min + egui::vec2(0., 24.),
                        egui::vec2(inner.width() * 0.8, 16.),
                    ),
                    egui::Rect::from_min_size(
                        inner.min + egui::vec2(0., 52.),
                        egui::vec2(24., 12.),
                    ),
                    egui::Rect::from_min_size(
                        inner.min + egui::vec2(32., 52.),
                        egui::vec2(40., 12.),
                    ),
                ] {
                    let phase = ui.input(|i| i.time) as f32 / 1.5;
                    let brightness = 28.
                        + 16.
                            * ((block.center().x / rect.width() - phase * 4.).fract()
                                * std::f32::consts::PI)
                                .sin()
                                .max(0.);
                    ui.painter()
                        .rect_filled(block, 14, Color32::from_gray(brightness as u8));
                }
                ui.add_space(-4.);
            }
            ui.ctx().request_repaint();
            return;
        }
        if items.is_empty() {
            let top = ui.next_widget_position();
            let bottom = ui.ctx().content_rect().bottom() - 17.;
            let scale = if cfg!(target_os = "linux") {
                self.settings.text_scale()
            } else {
                1.
            };
            let text = if self.tab == 4 {
                format!("No updates for {}.", self.update_course)
            } else {
                "Nothing here right now.".into()
            };
            let color = p.text.gamma_multiply(0.5);
            let galley = text_galley(
                ui,
                &text,
                14. * scale,
                20.3 * scale,
                "regular",
                ui.available_width(),
                usize::MAX,
                color,
                false,
            );
            let center_x = top.x + ui.available_width() / 2.;
            let y = (top.y + bottom) / 2. - (40. + galley.size().y) / 2.;
            let center = egui::pos2(center_x, y + 16.);
            ui.painter()
                .circle_stroke(center, 13.333, egui::Stroke::new(2.667_f32, color));
            ui.painter().line_segment(
                [
                    center - egui::vec2(5.333, 0.),
                    center + egui::vec2(5.333, 0.),
                ],
                egui::Stroke::new(2.667_f32, color),
            );
            ui.painter().galley(
                egui::pos2(center_x - galley.size().x / 2., y + 40.),
                galley,
                color,
            );
        } else {
            if self.settings.size == "Small" && (self.tab == 4 || !cfg!(target_os = "linux")) {
                items.truncate(1);
            }
            for item in items {
                self.card(ui, &item);
            }
        }
    }
    pub(super) fn settings_screen(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let linux = cfg!(target_os = "linux");
        let scale = if linux {
            self.settings.text_scale()
        } else {
            1.
        };
        let small = self.settings.size == "Small";
        let label = 14. * scale;
        let label_line = if linux { 19.6 * scale } else { 18. };
        let body = if linux { 14. * scale } else { 12. };
        let body_line = if linux { 19.6 * scale } else { 16. };
        let meta = if linux {
            12. * scale
        } else if small {
            9.
        } else {
            11.
        };
        let meta_line = if linux {
            16.8 * scale
        } else if small {
            12.
        } else {
            14.
        };
        let secondary = if self.hosted {
            p.muted
        } else {
            Color32::from_rgb(204, 194, 220)
        };
        let start = ui.next_widget_position() + egui::vec2(4., 4.);
        let width = ui.available_width() - 8.;
        let inner = width - 24.;
        let description = text_galley(
            ui,
            "Select a preset to snap the dimensions.",
            body,
            body_line,
            "regular",
            inner,
            usize::MAX,
            p.muted,
            false,
        );
        let track_y = start.y + 12. + label_line + 4. + description.size().y + 12.;
        let track_h = meta_line + if linux { 24. } else { 20. };
        let first =
            egui::Rect::from_min_size(start, egui::vec2(width, track_y + track_h + 12. - start.y));
        ui.painter().rect_filled(first, 12, p.card);
        paint_text(
            ui,
            start + egui::vec2(12., 12.),
            "Widget Size",
            label,
            label_line,
            "medium",
            inner,
            p.text,
        );
        ui.painter().galley(
            start + egui::vec2(12., 12. + label_line + 4.),
            description,
            p.muted,
        );
        let track = egui::Rect::from_min_size(
            egui::pos2(start.x + 12., track_y),
            egui::vec2(inner, track_h),
        );
        ui.painter().rect_filled(track, 12, p.background);
        let slot_width = (inner - 8.) / 3.;
        let index = ["Small", "Medium", "Large"]
            .iter()
            .position(|v| *v == self.settings.size)
            .unwrap_or(1);
        let animated =
            ui.ctx()
                .animate_value_with_time(egui::Id::new("settings-pill"), index as f32, 0.3);
        ui.painter().rect_filled(
            egui::Rect::from_min_size(
                track.min + egui::vec2(4. + slot_width * animated, 4.),
                egui::vec2(slot_width, track_h - 8.),
            ),
            12,
            p.success,
        );
        for (index, size) in ["Small", "Medium", "Large"].iter().enumerate() {
            let slot = egui::Rect::from_min_size(
                track.min + egui::vec2(4. + index as f32 * slot_width, 4.),
                egui::vec2(slot_width, track_h - 8.),
            );
            let galley = text_galley(
                ui,
                size,
                meta,
                meta_line,
                "semibold",
                slot_width,
                1,
                if self.settings.size == *size {
                    p.on_primary
                } else {
                    secondary
                },
                false,
            );
            ui.painter()
                .galley(slot.center() - galley.size() / 2., galley, p.text);
            if ui
                .interact(slot, ui.id().with(("size", size)), egui::Sense::click())
                .clicked()
            {
                self.settings.size = (*size).into();
                self.save_settings();
                if !self.hosted {
                    self.resize_pending = true;
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::InnerSize(
                        egui::Vec2::from(self.settings.dimensions(linux)) / ui.ctx().zoom_factor(),
                    ));
                }
                self.last_shape = Instant::now() - Duration::from_secs(2);
            }
        }
        let second_top = first.bottom() + 12.;
        let mut y = second_top + 12.;
        let dropdown_top = if linux {
            let top = y + label_line + 8.;
            y = top + 20.3 * scale + 18. + 12.;
            Some(top)
        } else {
            None
        };
        let launch_title = text_galley(
            ui,
            "Launch on Startup",
            label,
            label_line,
            "medium",
            inner,
            usize::MAX,
            p.text,
            false,
        );
        let launch_sub = text_galley(
            ui,
            "Start widget automatically",
            body,
            body_line,
            "regular",
            inner,
            usize::MAX,
            p.muted,
            false,
        );
        let text_width = launch_title.size().x.max(launch_sub.size().x);
        let text_height = launch_title.size().y + 8. + launch_sub.size().y;
        let wrap = text_width + 48. > inner;
        let row_height = text_height + if wrap { 30. } else { 0. };
        let second = egui::Rect::from_min_size(
            egui::pos2(start.x, second_top),
            egui::vec2(width, y + row_height + 12. - second_top),
        );
        ui.painter().rect_filled(second, 12, p.card);
        if let Some(top) = dropdown_top {
            paint_text(
                ui,
                egui::pos2(start.x + 12., second_top + 12.),
                "Text size",
                label,
                label_line,
                "medium",
                inner,
                p.text,
            );
            let dropdown = egui::Rect::from_min_size(
                egui::pos2(start.x + 12., top),
                egui::vec2(inner, 20.3 * scale + 18.),
            );
            let selected = match self.settings.text_size.as_str() {
                "Larger" => "Larger (112.5%)",
                "Largest" => "Largest (125%)",
                _ => "Standard (100%)",
            };
            ui.painter().rect(
                dropdown,
                8,
                p.background,
                egui::Stroke::new(1_f32, p.outline),
                egui::StrokeKind::Inside,
            );
            paint_text(
                ui,
                dropdown.min + egui::vec2(12., 9.),
                selected,
                14. * scale,
                20.3 * scale,
                "regular",
                inner - 36.,
                p.text,
            );
            let center = egui::pos2(dropdown.right() - 10., dropdown.center().y);
            ui.painter().add(egui::Shape::line(
                vec![
                    center + egui::vec2(-3., -2.),
                    center + egui::vec2(0., 1.),
                    center + egui::vec2(3., -2.),
                ],
                egui::Stroke::new(1.5_f32, p.text),
            ));
            let response = ui.interact(dropdown, ui.id().with("text-size"), egui::Sense::click());
            egui::Popup::menu(&response).show(|ui| {
                for (label, value) in [
                    ("Standard (100%)", "Standard"),
                    ("Larger (112.5%)", "Larger"),
                    ("Largest (125%)", "Largest"),
                ] {
                    if ui
                        .selectable_value(&mut self.settings.text_size, value.into(), label)
                        .clicked()
                    {
                        self.save_settings();
                        ui.close();
                    }
                }
            });
        }
        ui.painter()
            .galley(egui::pos2(start.x + 12., y), launch_title, p.text);
        ui.painter().galley(
            egui::pos2(start.x + 12., y + label_line + 8.),
            launch_sub,
            p.muted,
        );
        let mut startup = startup_status();
        let toggle = egui::Rect::from_min_size(
            egui::pos2(
                if wrap {
                    start.x + 12.
                } else {
                    second.right() - 52.
                },
                if wrap {
                    y + text_height + 8.
                } else {
                    y + (text_height - 22.) / 2.
                },
            ),
            egui::vec2(40., 22.),
        );
        ui.painter().rect(
            toggle,
            11,
            if startup { p.success } else { p.background },
            egui::Stroke::new(1_f32, if startup { p.success } else { p.outline }),
            egui::StrokeKind::Inside,
        );
        let switch =
            ui.ctx()
                .animate_bool_with_time(ui.id().with("startup-animation"), startup, 0.3);
        ui.painter().circle_filled(
            egui::pos2(toggle.left() + 11. + 18. * switch, toggle.center().y),
            8.,
            if startup { p.on_primary } else { secondary },
        );
        if ui
            .interact(toggle, ui.id().with("startup"), egui::Sense::click())
            .clicked()
        {
            startup = !startup;
            if let Err(error) = set_startup(startup) {
                self.error = Some(error.to_string());
            }
        }
        let footer_height = meta_line + 12. + 24.;
        let footer_y =
            (ui.ctx().content_rect().bottom() - 21. - footer_height).max(second.bottom() + 12.);
        let footer = egui::Rect::from_min_size(
            egui::pos2(start.x, footer_y),
            egui::vec2(width, footer_height),
        );
        ui.painter().rect_filled(footer, 12, p.card);
        let syncing = self.manual_sync
            || self
                .sync_feedback_until
                .is_some_and(|until| Instant::now() < until);
        let button_text = if syncing { "Syncing..." } else { "Force Sync" };
        let text = text_galley(
            ui,
            button_text,
            meta,
            meta_line,
            "semibold",
            inner,
            1,
            p.on_primary,
            false,
        );
        let button = egui::Rect::from_min_size(
            footer.min + egui::vec2(12., 12.),
            text.size() + egui::vec2(24., 12.),
        );
        ui.painter().rect_filled(button, 100, p.success);
        ui.painter()
            .galley(button.min + egui::vec2(12., 6.), text, p.on_primary);
        if ui
            .interact(button, ui.id().with("force-sync"), egui::Sense::click())
            .clicked()
            && !syncing
        {
            self.manual_sync = true;
            self.fetch(false);
        }
        let label = self
            .last_fetch
            .map(|t| {
                let mins = (Utc::now() - t).num_minutes().max(0);
                if mins == 0 {
                    "Just now".into()
                } else {
                    format!("{mins}m ago")
                }
            })
            .unwrap_or("v0.0.0".into());
        let galley = text_galley(
            ui, &label, body, body_line, "regular", inner, 1, p.muted, false,
        );
        ui.painter().galley(
            egui::pos2(
                footer.right() - 12. - galley.size().x,
                footer.center().y - galley.size().y / 2.,
            ),
            galley,
            p.muted,
        );
        ui.advance_cursor_after_rect(footer);
    }
    pub(super) fn task_form(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let Some(mut form) = self.form.take() else {
            return;
        };
        let viewport = ui.ctx().content_rect();
        let linux = cfg!(target_os = "linux");
        let compact = self.settings.size == "Small";
        let scale = if linux {
            self.settings.text_scale()
        } else {
            1.
        };
        let metadata = if linux {
            12. * scale
        } else if compact {
            9.
        } else {
            11.
        };
        let line = if linux {
            16.8 * scale
        } else if compact {
            12.
        } else {
            14.
        };
        let title_size = if linux {
            13. * scale
        } else if compact {
            10.
        } else {
            12.
        };
        let title_line = if linux {
            18.2 * scale
        } else if compact {
            14.
        } else {
            16.
        };
        let close =
            egui::Rect::from_min_size(viewport.min + egui::vec2(9., 13.), egui::vec2(24., 24.));
        let close_response = ui
            .interact(close, ui.id().with("close-form"), egui::Sense::click())
            .on_hover_text("Close");
        if close_response.hovered() {
            ui.painter().circle_filled(close.center(), 12., p.error);
        }
        egui::Image::new(egui::include_image!("../../assets/icons/close-tab.svg"))
            .tint(if close_response.hovered() {
                p.on_primary
            } else {
                p.muted
            })
            .paint_at(
                ui,
                egui::Rect::from_center_size(close.center(), egui::vec2(14., 14.)),
            );
        paint_text(
            ui,
            egui::pos2(viewport.left() + 41., 25. - title_line / 2.),
            "New Task",
            title_size,
            title_line,
            "medium",
            viewport.width() - 54.,
            p.text,
        );
        let mut closed = close_response.clicked();
        let start = viewport.min + egui::vec2(13., 49.);
        let width = viewport.width() - 26.;
        let height = line + 16.;
        let mut responses = Vec::new();
        for (index, (value, placeholder)) in [
            (&mut form.title, "Title"),
            (&mut form.course, "Course"),
            (&mut form.estimate, "Time Estimate (e.g. 30m)"),
            (&mut form.date, "mm/dd/yyyy --:-- --"),
        ]
        .into_iter()
        .enumerate()
        {
            let rect = egui::Rect::from_min_size(
                start + egui::vec2(0., index as f32 * (height + 6.)),
                egui::vec2(width, height),
            );
            ui.painter().rect_filled(rect, 14, p.card);
            let mut text_rect = rect;
            if index == 3 {
                text_rect.max.x -= 28.;
            }
            let response = ui.put(
                text_rect,
                egui::TextEdit::singleline(&mut *value)
                    .id(ui.id().with(("task-field", index)))
                    .frame(false)
                    .font(egui::FontId::new(
                        metadata,
                        egui::FontFamily::Name("medium".into()),
                    ))
                    .hint_text(RichText::new(placeholder).color(Color32::from_gray(117)))
                    .margin(egui::vec2(12., 8.)),
            );
            if response.changed() {
                form.error = None;
            }
            if response.has_focus() {
                ui.painter().rect_stroke(
                    rect,
                    14,
                    egui::Stroke::new(1.5_f32, p.text),
                    egui::StrokeKind::Outside,
                );
            }
            responses.push(response);
            if index == 3 {
                let icon = egui::Rect::from_min_size(
                    egui::pos2(rect.right() - 28., rect.center().y - 10.),
                    egui::vec2(20., 20.),
                );
                egui::Image::new(egui::include_image!("../../assets/icons/calendar.svg"))
                    .tint(p.muted)
                    .paint_at(ui, icon.shrink(3.));
                let changed = ui
                    .scope(|ui| {
                        for visuals in [&mut ui.visuals_mut().widgets.inactive] {
                            visuals.weak_bg_fill = Color32::TRANSPARENT;
                            visuals.bg_stroke = egui::Stroke::NONE;
                        }
                        ui.put(
                            icon,
                            egui_extras::DatePickerButton::new(&mut form.picker)
                                .id_salt("task-date")
                                .show_icon(false)
                                .format("")
                                .calendar_week(false)
                                .highlight_weekends(false),
                        )
                        .changed()
                    })
                    .inner;
                if changed {
                    *value = form.picker.format("%m/%d/%Y 12:00 AM").to_string();
                    form.error = None;
                }
            }
        }
        let button = egui::Rect::from_min_size(
            egui::pos2(start.x, start.y + 4. * height + 3. * 6. + 18.),
            egui::vec2(width, title_line + 20.),
        );
        ui.painter().rect_filled(button, 14, p.success);
        let text = text_galley(
            ui,
            "Add Task",
            title_size,
            title_line,
            "bold",
            width,
            1,
            p.on_primary,
            false,
        );
        ui.painter()
            .galley(button.center() - text.size() / 2., text, p.on_primary);
        let submit = ui
            .interact(button, ui.id().with("add-task"), egui::Sense::click())
            .clicked()
            || (responses.iter().any(|r| r.lost_focus())
                && ui.input(|i| i.key_pressed(egui::Key::Enter)));
        if submit {
            let parsed = ["%Y-%m-%dT%H:%M", "%m/%d/%Y %I:%M %p"]
                .iter()
                .find_map(|format| chrono::NaiveDateTime::parse_from_str(&form.date, format).ok());
            let deadline = parsed.and_then(|date| Local.from_local_datetime(&date).earliest());
            if let Some(deadline) = deadline.filter(|_| !form.title.is_empty()) {
                self.add(Item {
                    id: Utc::now().timestamp_millis().to_string(),
                    kind: "deadline".into(),
                    title: form.title.clone(),
                    course: if form.course.is_empty() {
                        "Personal".into()
                    } else {
                        form.course.clone()
                    },
                    due_date: Some(deadline.to_rfc3339()),
                    time_estimate: (!form.estimate.is_empty()).then(|| form.estimate.clone()),
                    ..Default::default()
                });
                closed = true;
            } else {
                let index = if form.title.is_empty() { 0 } else { 3 };
                responses[index].request_focus();
                form.error = Some(index.to_string());
            }
        }
        if let Some(index) = form.error.as_ref().and_then(|s| s.parse::<usize>().ok()) {
            let position = responses[index].rect.left_bottom() + egui::vec2(12., 4.);
            egui::Area::new(ui.id().with("required-field"))
                .order(egui::Order::Tooltip)
                .fixed_pos(position)
                .show(ui.ctx(), |ui| {
                    egui::Frame::new()
                        .fill(Color32::from_rgb(255, 255, 238))
                        .corner_radius(3)
                        .stroke(egui::Stroke::new(1_f32, Color32::from_gray(120)))
                        .inner_margin(8)
                        .show(ui, |ui| {
                            ui.label(
                                RichText::new("Please fill out this field.")
                                    .size(12.)
                                    .color(Color32::BLACK),
                            );
                        });
                });
        }
        if !closed {
            self.form = Some(form);
        }
    }
    pub(super) fn calendar(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        if self.import_open {
            self.schedule_screen(ui);
            return;
        }
        let small = self.settings.size == "Small";
        let parsed_courses = schedule::parse(&self.schedule_text);
        let show_grid = !small || self.selected_day.is_none();
        let grid_start = ui.next_widget_position() + egui::vec2(4., 0.);
        let grid_width = ui.available_width() - 8.;
        let scale = if cfg!(target_os = "linux") {
            self.settings.text_scale()
        } else {
            1.
        };
        let metadata = if cfg!(target_os = "linux") {
            12. * scale
        } else {
            10.
        };
        if show_grid {
            let header = egui::Rect::from_min_size(grid_start, egui::vec2(grid_width, 26.));
            for (direction, center) in [
                (-1, header.left_center() + egui::vec2(11., 0.)),
                (1, header.right_center() - egui::vec2(11., 0.)),
            ] {
                let rect = egui::Rect::from_center_size(center, egui::vec2(22., 26.));
                let d = direction as f32;
                ui.painter().add(egui::Shape::line(
                    vec![
                        center + egui::vec2(-d * 3.5, -5.),
                        center + egui::vec2(d * 1.5, 0.),
                        center + egui::vec2(-d * 3.5, 5.),
                    ],
                    egui::Stroke::new(1.5_f32, p.text),
                ));
                if ui
                    .interact(
                        rect,
                        ui.id().with(("month", direction)),
                        egui::Sense::click(),
                    )
                    .clicked()
                {
                    self.month = if direction < 0 {
                        self.month
                            .checked_sub_months(chrono::Months::new(1))
                            .unwrap()
                    } else {
                        self.month
                            .checked_add_months(chrono::Months::new(1))
                            .unwrap()
                    };
                }
            }
            let month = text_galley(
                ui,
                &self.month.format("%b %Y").to_string(),
                metadata,
                metadata * 1.4,
                "bold",
                grid_width,
                1,
                p.text,
                false,
            );
            ui.painter()
                .galley(header.center() - month.size() / 2., month, p.text);
            let next = self
                .month
                .checked_add_months(chrono::Months::new(1))
                .unwrap();
            let count = (next - self.month).num_days() as u32;
            let offset = self.month.weekday().num_days_from_sunday();
            let cell_width = grid_width / 7.;
            let weekday_y = header.bottom() + 8.;
            for (i, day) in ["S", "M", "T", "W", "T", "F", "S"].iter().enumerate() {
                let text = text_galley(
                    ui,
                    day,
                    metadata,
                    metadata * 1.4,
                    "medium",
                    cell_width,
                    1,
                    p.text.gamma_multiply(0.5),
                    false,
                );
                ui.painter().galley(
                    egui::pos2(
                        grid_start.x + (i as f32 + 0.5) * cell_width - text.size().x / 2.,
                        weekday_y,
                    ),
                    text,
                    p.text,
                );
            }
            let diameter = if cfg!(target_os = "linux") {
                28. * scale
            } else {
                20.
            };
            let grid_top = weekday_y + metadata * 1.4 + 4.;
            let rows = (offset + count).div_ceil(7);
            for cell in 0..rows * 7 {
                if cell < offset || cell >= offset + count {
                    continue;
                }
                let day = self.month.with_day(cell - offset + 1).unwrap();
                let tasks: Vec<_> = self
                    .state
                    .items
                    .iter()
                    .filter(|i| {
                        matches!(i.kind.as_str(), "deadline" | "event")
                            && i.timestamp()
                                .is_some_and(|d| d.with_timezone(&Local).date_naive() == day)
                    })
                    .collect();
                let count = tasks.len();
                let completed = count > 0 && tasks.iter().all(|i| i.completed);
                let name = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
                    [day.weekday().num_days_from_sunday() as usize];
                let class = parsed_courses.iter().any(|c| c.day == name);
                let center = egui::pos2(
                    grid_start.x + (cell % 7) as f32 * cell_width + cell_width / 2.,
                    grid_top + (cell / 7) as f32 * (diameter + 2.) + diameter / 2.,
                );
                let (fill, border, text) = if completed {
                    (
                        Color32::from_rgba_unmultiplied(40, 200, 64, 51),
                        Color32::from_rgba_unmultiplied(40, 200, 64, 128),
                        Color32::from_rgb(40, 200, 64),
                    )
                } else if count >= 3 {
                    (p.error, p.error, p.text)
                } else if count > 0 {
                    (
                        Color32::from_rgba_unmultiplied(255, 149, 0, 102),
                        Color32::from_rgba_unmultiplied(255, 149, 0, 102),
                        p.text,
                    )
                } else {
                    (Color32::TRANSPARENT, p.card, p.text)
                };
                ui.painter().circle(
                    center,
                    diameter / 2. - 0.5,
                    fill,
                    egui::Stroke::new(1_f32, border),
                );
                let galley = text_galley(
                    ui,
                    &day.day().to_string(),
                    metadata,
                    metadata * 1.4,
                    if count > 0 || class {
                        "bold"
                    } else {
                        "regular"
                    },
                    diameter,
                    1,
                    text,
                    false,
                );
                ui.painter()
                    .galley(center - galley.size() / 2., galley, text);
                if class {
                    ui.painter().circle_filled(
                        center + egui::vec2(0., diameter / 2. - 3.5),
                        1.5,
                        p.primary,
                    );
                }
                if ui
                    .interact(
                        egui::Rect::from_center_size(center, egui::vec2(diameter, diameter)),
                        ui.id().with(("day", cell)),
                        egui::Sense::click(),
                    )
                    .clicked()
                    && (count > 0 || class)
                {
                    self.selected_day = Some(day);
                    self.archive = self
                        .profile
                        .read(&format!("archive/{}.json", day.format("%Y-%m-%d")))
                        .unwrap_or_default();
                }
            }
            let grid = egui::Rect::from_min_max(
                grid_start,
                egui::pos2(
                    grid_start.x + grid_width,
                    grid_top + rows as f32 * (diameter + 2.) - 2.,
                ),
            );
            ui.advance_cursor_after_rect(grid);
            if self.selected_day.is_some() {
                ui.add_space(16.);
                ui.separator();
            }
        }
        if let Some(day) = self.selected_day {
            ui.horizontal(|ui| {
                if ui.button("‹").clicked() {
                    self.selected_day = None;
                }
                ui.label(day.format("%a, %b %-d").to_string());
            });
            let name = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
                [day.weekday().num_days_from_sunday() as usize];
            let classes: Vec<_> = parsed_courses
                .iter()
                .filter(|c| c.day == name)
                .cloned()
                .collect();
            for course in classes {
                ui.label(
                    RichText::new(format!("{} {}", course.time_slot, course.course_code))
                        .color(p.primary),
                );
                ui.label(format!("{} · {}", course.venue, course.teacher));
            }
            let mut items: Vec<_> = self
                .state
                .items
                .iter()
                .filter(|i| {
                    matches!(i.kind.as_str(), "deadline" | "event")
                        && i.timestamp()
                            .is_some_and(|d| d.with_timezone(&Local).date_naive() == day)
                })
                .cloned()
                .collect();
            for item in &self.archive {
                if !items.iter().any(|i| i.id == item.id) {
                    items.push(item.clone());
                }
            }
            items.sort_by_key(Item::timestamp);
            for item in items {
                self.card(ui, &item);
            }
        }
        if show_grid {
            let size = if cfg!(target_os = "linux") {
                13. * scale
            } else {
                12.
            };
            let line = if cfg!(target_os = "linux") {
                18.2 * scale
            } else {
                16.
            };
            let height = line + 14.;
            let y = (ui.ctx().content_rect().bottom() - 21. - height)
                .max(ui.next_widget_position().y + 4.);
            let mut right = grid_start.x + grid_width;
            for (label, schedule) in [("Import", false), ("Schedule", true)] {
                let color = if schedule { p.primary } else { p.on_primary };
                let text = text_galley(
                    ui, label, size, line, "semibold", grid_width, 1, color, false,
                );
                let width = text.size().x + 46. + if schedule { 2. } else { 0. };
                let rect = egui::Rect::from_min_size(
                    egui::pos2(right - width, y),
                    egui::vec2(width, height),
                );
                ui.painter().rect(
                    rect,
                    100,
                    if schedule { p.card } else { p.success },
                    egui::Stroke::new(if schedule { 1_f32 } else { 0. }, p.outline),
                    egui::StrokeKind::Inside,
                );
                let image = if schedule {
                    egui::include_image!("../../assets/icons/schedule.svg")
                } else {
                    egui::include_image!("../../assets/icons/import.svg")
                };
                egui::Image::new(image).tint(color).paint_at(
                    ui,
                    egui::Rect::from_center_size(
                        egui::pos2(rect.left() + 21., rect.center().y),
                        egui::vec2(14., 14.),
                    ),
                );
                ui.painter().galley(
                    egui::pos2(rect.left() + 32., rect.center().y - text.size().y / 2.),
                    text,
                    color,
                );
                if ui
                    .interact(
                        rect,
                        ui.id().with(("calendar-action", schedule)),
                        egui::Sense::click(),
                    )
                    .clicked()
                {
                    self.import_open = true;
                    self.import_schedule = schedule;
                }
                right = rect.left() - 8.;
            }
            ui.advance_cursor_after_rect(egui::Rect::from_min_size(
                egui::pos2(grid_start.x, y),
                egui::vec2(grid_width, height + 4.),
            ));
        }
    }
    fn schedule_screen(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        ui.horizontal(|ui| {
            ui.heading(if self.import_schedule {
                "Your Schedule"
            } else {
                "Smart Import"
            });
            if ui.button("Back").clicked() {
                self.import_open = false;
            }
        });
        if self.import_schedule {
            ui.horizontal_wrapped(|ui| {
                for (i, day) in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
                    .iter()
                    .enumerate()
                {
                    ui.selectable_value(&mut self.import_day, i, *day);
                }
            });
            let day = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][self.import_day];
            let mut courses: Vec<_> = schedule::parse(&self.schedule_text)
                .into_iter()
                .filter(|c| c.day == day)
                .collect();
            courses.sort_by_key(|c| {
                let start = c.time_slot.split('-').next().unwrap_or("").trim();
                chrono::NaiveTime::parse_from_str(start, "%I:%M%p").ok()
            });
            if courses.is_empty() {
                ui.label("No classes on this day.");
            }
            for c in courses {
                egui::Frame::new()
                    .fill(p.card)
                    .corner_radius(12)
                    .inner_margin(10)
                    .show(ui, |ui| {
                        ui.label(RichText::new(c.time_slot).color(p.primary));
                        ui.label(
                            RichText::new(c.course_code)
                                .strong()
                                .family(egui::FontFamily::Name("semibold".into())),
                        );
                        ui.label(c.course_title);
                        ui.label(format!("{} · {}", c.venue, c.teacher));
                        if c.is_online {
                            ui.colored_label(p.error, "Online");
                        }
                    });
                ui.add_space(8.);
            }
        } else {
            ui.add(
                egui::TextEdit::multiline(&mut self.schedule_text)
                    .hint_text("Paste schedule table...")
                    .font(egui::TextStyle::Monospace)
                    .desired_rows(12)
                    .desired_width(f32::INFINITY),
            );
            let count = schedule::parse(&self.schedule_text).len();
            if count > 0 {
                ui.label(format!("{count} detected"));
            }
            ui.horizontal(|ui| {
                if count > 0 && ui.button("View").clicked() {
                    self.import_schedule = true;
                }
                if pill(ui, "Save").clicked() {
                    self.save_schedule();
                }
            });
            if let Some(status) = &self.import_status {
                ui.colored_label(
                    if status == "Saved!" {
                        p.primary
                    } else {
                        p.error
                    },
                    status,
                );
            }
        }
    }
    pub(super) fn ai(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let rect = ui.max_rect();
        let scale = if cfg!(target_os = "linux") {
            self.settings.text_scale()
        } else {
            1.
        };
        let body_size = 14. * scale;
        let body_line = if cfg!(target_os = "linux") {
            20.3 * scale
        } else {
            18.
        };
        if self.ai_checking || !self.ai_online || !self.ai_ready {
            let compact = self.settings.size == "Small";
            let content_height = if self.ai_checking {
                body_line
            } else if self.ai_pulling {
                100.
            } else if compact {
                116.
            } else {
                198.
            };
            let centered = egui::Rect::from_min_size(
                egui::pos2(rect.left(), rect.center().y - content_height / 2.),
                egui::vec2(rect.width(), content_height),
            );
            ui.scope_builder(egui::UiBuilder::new().max_rect(centered), |ui| {
                ui.spacing_mut().item_spacing.y = 12.;
                ui.vertical_centered(|ui| {
                    if self.ai_checking {
                        ui.label(
                            RichText::new("Checking AI connection...")
                                .size(body_size)
                                .color(p.muted),
                        );
                        return;
                    }
                    if self.ai_pulling {
                        ui.label(
                            RichText::new("Downloading Model...")
                                .size(18. * scale)
                                .family(egui::FontFamily::Name("semibold".into())),
                        );
                        ui.add_space(if compact { 8. } else { 16. });
                        let (track, _) = ui.allocate_exact_size(
                            egui::vec2(rect.width() * 0.8, 8.),
                            egui::Sense::hover(),
                        );
                        ui.painter().rect_filled(track, 4, p.background);
                        let mut progress = track;
                        progress.set_width(track.width() * self.ai_progress as f32 / 100.);
                        ui.painter().rect_filled(progress, 4, p.primary);
                        ui.label(
                            RichText::new(format!("{}%", self.ai_progress))
                                .size(12. * scale)
                                .color(p.primary),
                        );
                        return;
                    }
                    let icon = if self.ai_online {
                        egui::include_image!("../../assets/icons/download.svg")
                    } else {
                        egui::include_image!("../../assets/icons/offline.svg")
                    };
                    let size = if compact { 32. } else { 48. };
                    ui.add(
                        egui::Image::new(icon)
                            .fit_to_exact_size(egui::vec2(size, size))
                            .tint(if self.ai_online { p.primary } else { p.error }),
                    );
                    ui.label(
                        RichText::new(if self.ai_online {
                            "Model Required"
                        } else {
                            "Ollama Not Found"
                        })
                        .size(18. * scale)
                        .family(egui::FontFamily::Name("semibold".into())),
                    );
                    if !compact {
                        ui.label(
                            RichText::new(if self.ai_online {
                                "The qwen2.5:3b model is required for AI Chat."
                            } else {
                                "Please install and run Ollama locally on port 11434."
                            })
                            .size(body_size)
                            .color(p.muted),
                        );
                    }
                    ui.add_space(if compact { 4. } else { 12. });
                    if !self.ai_online {
                        ui.horizontal(|ui| {
                            ui.add_space(((ui.available_width() - 152.) / 2.).max(0.));
                            if pill(ui, "Download").clicked() {
                                open_external("https://ollama.com/download");
                            }
                            if ui
                                .add(
                                    egui::Button::new(RichText::new("Retry").color(p.primary))
                                        .fill(Color32::TRANSPARENT)
                                        .stroke(egui::Stroke::new(1_f32, p.primary))
                                        .corner_radius(100),
                                )
                                .clicked()
                            {
                                self.check_ai();
                            }
                        });
                    } else if pill(ui, "Download Model").clicked() {
                        self.ai_pulling = true;
                        self.ai_progress = 0;
                        let tx = self.tx.clone();
                        self.rt.spawn(async move {
                            let progress_tx = tx.clone();
                            let result = Ollama::default()
                                .pull(move |p| {
                                    let _ = progress_tx.send(Event::Pull(p));
                                })
                                .await
                                .map_err(|e| e.to_string());
                            let _ = tx.send(Event::PullDone(result));
                        });
                    }
                });
            });
            return;
        }
        let form_height = 53.;
        let message_height = (rect.height() - form_height).max(40.);
        egui::ScrollArea::vertical()
            .id_salt("messages")
            .stick_to_bottom(true)
            .auto_shrink([false, false])
            .max_height(message_height)
            .show(ui, |ui| {
                ui.add_space(8.);
                let messages = self
                    .messages
                    .iter()
                    .map(|m| (m["role"] == "user", m["content"].as_str().unwrap_or("")))
                    .chain(self.typing.then_some((false, "Typing...")));
                for (user, text) in messages {
                    let content_width = (rect.width() - 16.).max(20.);
                    let color = if user { p.on_primary } else { p.muted };
                    let galley = text_galley(
                        ui,
                        text,
                        body_size,
                        body_line,
                        "regular",
                        (content_width * 0.85 - 24.).max(16.),
                        usize::MAX,
                        color,
                        false,
                    );
                    let size = galley.size() + egui::vec2(24., 16.);
                    let (row, _) = ui.allocate_exact_size(
                        egui::vec2(rect.width(), size.y),
                        egui::Sense::hover(),
                    );
                    let bubble = egui::Rect::from_min_size(
                        egui::pos2(
                            if user {
                                row.right() - 8. - size.x
                            } else {
                                row.left() + 8.
                            },
                            row.top(),
                        ),
                        size,
                    );
                    if user {
                        ui.painter().rect_filled(
                            bubble,
                            egui::CornerRadius {
                                nw: 16,
                                ne: 16,
                                sw: 16,
                                se: 4,
                            },
                            p.primary,
                        );
                    }
                    ui.painter()
                        .galley(bubble.min + egui::vec2(12., 8.), galley, color);
                }
                ui.add_space(8.);
            });
        let form = egui::Rect::from_min_max(
            egui::pos2(rect.left(), rect.bottom() - form_height),
            rect.right_bottom(),
        );
        ui.painter().hline(
            form.x_range(),
            form.top(),
            egui::Stroke::new(1_f32, p.outline),
        );
        let input = egui::Rect::from_min_max(
            form.left_top() + egui::vec2(8., 9.),
            form.right_bottom() - egui::vec2(52., 8.),
        );
        let edit = ui
            .scope(|ui| {
                ui.visuals_mut().widgets.inactive.corner_radius = egui::CornerRadius::same(20);
                ui.put(
                    input,
                    egui::TextEdit::singleline(&mut self.chat_input)
                        .interactive(!self.typing)
                        .hint_text(
                            RichText::new("Ask me anything...").color(Color32::from_gray(117)),
                        )
                        .font(egui::FontId::proportional(body_size))
                        .background_color(p.background)
                        .margin(egui::vec2(12., 8.)),
                )
            })
            .inner;
        let button = egui::Rect::from_min_size(
            egui::pos2(form.right() - 44., form.top() + 9.),
            egui::vec2(36., 36.),
        );
        let enabled = !self.typing && !self.chat_input.trim().is_empty();
        let response = ui
            .scope(|ui| {
                if !enabled {
                    ui.set_opacity(0.5);
                }
                ui.put(
                    button,
                    egui::Button::image(
                        egui::Image::new(egui::include_image!("../../assets/icons/send.svg"))
                            .fit_to_exact_size(egui::vec2(18., 18.))
                            .tint(p.on_primary),
                    )
                    .fill(p.primary)
                    .corner_radius(100),
                )
            })
            .inner;
        let send = enabled
            && (response.clicked()
                || (edit.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter))));
        if send && !self.chat_input.trim().is_empty() {
            let text = self.chat_input.trim().to_owned();
            self.chat_input.clear();
            self.messages.push(json!({"role":"user","content":text}));
            self.typing = true;
            let history = json!(self.messages);
            let tx = self.tx.clone();
            self.rt.spawn(async move {
                let api = Ollama::default();
                let (chat, command) =
                    tokio::join!(api.chat(history, None), api.parse_command(&text));
                let reply = chat
                    .ok()
                    .and_then(|v| v["message"]["content"].as_str().map(str::to_owned));
                let _ = tx.send(Event::Chat(reply, command.ok()));
            });
        }
    }
}
