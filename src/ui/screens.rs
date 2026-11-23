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
    job.round_output_to_gui = false;
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
// CSS textarea tab-size defaults to eight spaces, with stops relative to each line.
// Keep the original characters so editing, selection and pasted TSV stay lossless.
pub(super) fn schedule_galley(
    ui: &egui::Ui,
    text: &str,
    font: egui::FontId,
    line: f32,
    color: Color32,
) -> Arc<egui::Galley> {
    ui.fonts_mut(|fonts| {
        let mut job = egui::text::LayoutJob::default();
        job.round_output_to_gui = false;
        let format = egui::TextFormat {
            font_id: font.clone(),
            color,
            line_height: Some(line),
            ..Default::default()
        };
        let stop = fonts.glyph_width(&font, ' ') * 8.;
        let tab = fonts.glyph_width(&font, '\t');
        let mut x = 0.;
        if text.is_empty() {
            job.append("", 0., format.clone());
        }
        for piece in text.split_inclusive(['\t', '\n']) {
            let separator = piece.chars().last().filter(|c| matches!(c, '\t' | '\n'));
            let plain = if separator.is_some() {
                &piece[..piece.len() - 1]
            } else {
                piece
            };
            if !plain.is_empty() {
                x += fonts
                    .layout_no_wrap(plain.into(), font.clone(), color)
                    .size()
                    .x;
                job.append(plain, 0., format.clone());
            }
            if let Some(separator) = separator {
                if separator == '\t' {
                    let advance = stop - x.rem_euclid(stop);
                    job.append("\t", advance - tab, format.clone());
                    x += advance;
                } else {
                    job.append("\n", 0., format.clone());
                    x = 0.;
                }
            }
        }
        fonts.layout_job(job)
    })
}
pub(super) fn squircle(
    rect: egui::Rect,
    radius: f32,
    top_only: bool,
    fill: Color32,
    stroke: egui::Stroke,
) -> egui::Shape {
    let mut points = Vec::new();
    for (index, (center, start)) in [
        (
            rect.left_top() + egui::vec2(radius, radius),
            std::f32::consts::PI,
        ),
        (
            rect.right_top() + egui::vec2(-radius, radius),
            std::f32::consts::PI * 1.5,
        ),
        (rect.right_bottom() - egui::vec2(radius, radius), 0.),
        (
            rect.left_bottom() + egui::vec2(radius, -radius),
            std::f32::consts::FRAC_PI_2,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        if top_only && index >= 2 {
            points.push(if index == 2 {
                rect.right_bottom()
            } else {
                rect.left_bottom()
            });
            continue;
        }
        for step in 0..=24 {
            let theta = start + step as f32 / 24. * std::f32::consts::FRAC_PI_2;
            let x = theta.cos();
            let y = theta.sin();
            points.push(
                center
                    + radius * egui::vec2(x.signum() * x.abs().sqrt(), y.signum() * y.abs().sqrt()),
            );
        }
    }
    egui::Shape::Path(egui::epaint::PathShape {
        points,
        closed: true,
        fill,
        stroke: stroke.into(),
    })
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
    pub(super) fn canvas_status(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        if self.credential_read_failed {
            ui.horizontal_wrapped(|ui| {
                ui.colored_label(p.muted, "Canvas session unavailable");
                if ui.small_button("Retry").clicked() {
                    self.boot();
                }
            });
        } else if self.reconnect_required {
            ui.horizontal_wrapped(|ui| {
                ui.colored_label(p.muted, "Showing saved tasks");
                let signing_in = self.auth_waiting || self.auth_success.is_some();
                let label = if signing_in { "Signing in…" } else { "Reconnect Canvas" };
                if ui.add_enabled(!signing_in, egui::Button::new(label).small()).clicked() {
                    self.login();
                }
            });
            if let Some(error) = &self.error {
                ui.colored_label(p.error, error);
            }
        } else if self.session_unsaved {
            ui.horizontal_wrapped(|ui| {
                ui.colored_label(p.muted, "Canvas session could not be saved");
                if ui.add_enabled(!self.fetching, egui::Button::new("Retry").small()).clicked() {
                    self.fetch(false);
                }
            });
        }
    }

    pub(super) fn header(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let compact = self.settings.size == "Small" || ui.ctx().content_rect().width() <= 310.;
        let size = if compact { 26. } else { 32. };
        let gap = if compact { 4. } else { 8. };
        let (rect, _) = ui.allocate_exact_size(
            egui::vec2(
                ui.available_width(),
                size + if self.hosted { 1. } else { 0. },
            ),
            egui::Sense::hover(),
        );
        let drag = ui.interact(rect, ui.id().with("window-drag"), egui::Sense::drag());
        if drag.drag_started() && !self.hosted {
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::StartDrag);
        }
        let clip = ui.clip_rect();
        ui.set_clip_rect(ui.ctx().content_rect());
        let start = ui.ctx().content_rect().min + egui::vec2(if compact { 9. } else { 17. }, 9.);
        let animated =
            ui.ctx()
                .animate_value_with_time(egui::Id::new("tab-position"), self.tab as f32, 0.3);
        if self.hosted {
            let pill = egui::Rect::from_min_size(
                start + egui::vec2(animated * (size + gap), 0.),
                egui::vec2(size, size),
            );
            ui.painter().add(
                egui::epaint::Shadow {
                    offset: [0, 2],
                    blur: 7,
                    spread: 0,
                    color: Color32::from_rgba_unmultiplied(0, 107, 95, 24),
                }
                .as_shape(pill, size / 2.),
            );
        }
        ui.painter().rect_filled(
            egui::Rect::from_min_size(
                start + egui::vec2(animated * (size + gap), 0.),
                egui::vec2(size, size),
            ),
            size / 2.,
            if self.tab == 0 && !self.hosted {
                p.primary
            } else {
                p.success
            },
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
        // Compact tabs extend beyond the body margin. Keep their absolute bounds
        // out of the parent's layout so the following content retains that margin.
        let mut tabs_ui = ui.new_child(
            egui::UiBuilder::new()
                .id_salt("tab-buttons")
                .max_rect(ui.ctx().content_rect()),
        );
        for (index, label) in TABS.iter().enumerate() {
            let button = egui::Rect::from_min_size(
                start + egui::vec2(index as f32 * (size + gap), 0.),
                egui::vec2(size, size),
            );
            let image = egui::Image::new(icon(index))
                .fit_to_exact_size(egui::vec2(16., 16.))
                .tint(if self.tab == index {
                    if index == 0 && !self.hosted {
                        p.text
                    } else {
                        p.on_primary
                    }
                } else {
                    p.muted
                });
            if self.hosted
                && ui.input(|input| {
                    input
                        .pointer
                        .hover_pos()
                        .is_some_and(|point| button.contains(point))
                })
            {
                ui.painter()
                    .rect_filled(button, size / 2., Color32::from_rgb(222, 240, 230));
            }
            let response = tabs_ui
                .put(button, egui::Button::image(image).frame(false))
                .on_hover_text(*label);
            response
                .widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, *label));
            if response.clicked() {
                self.switch_tab(index);
            }
        }
        if !self.hosted {
            let close = egui::Rect::from_min_size(
                ui.ctx().content_rect().right_top()
                    + egui::vec2(-if compact { 33. } else { 41. }, 9. + (size - 24.) / 2.),
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
        ui.set_clip_rect(clip);
        ui.advance_cursor_after_rect(rect);
    }
    fn card_foreground(
        &self,
        ui: &mut egui::Ui,
        item: &Item,
    ) -> (egui::epaint::RectShape, egui::layers::ShapeIdx, Option<egui::Rect>) {
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
            let title_color = faded(
                if self.hosted {
                    Color32::from_rgb(21, 59, 46)
                } else {
                    color
                },
                0.7,
            );
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
            let mut y = py + row + if compact { 2. } else { 4. } + 2.;
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
        let background = egui::epaint::RectShape::filled(
            rect,
            radius,
            if item.completed { p.success } else { p.card },
        );
        // Reserve the layer behind text while the caller checks hover on the finished card.
        let background_index = ui.painter().add(egui::Shape::Noop);
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
        (background, background_index, zoom)
    }
    pub(super) fn auth(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let rect = ui.ctx().content_rect().shrink(1.);
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
        let title = if self.hosted {
            25.
        } else {
            (if cfg!(target_os = "linux") { 16. } else { 14. }) * scale * text
        };
        let title_color = if self.hosted {
            Color32::from_rgb(21, 59, 46)
        } else {
            p.text
        };
        let logo_size = if self.hosted { 48. } else { 32. * scale };
        let label = if cfg!(target_os = "linux") { 13. } else { 12. } * scale * text;
        let success = self.auth_success.is_some();
        let width =
            (rect.width() - 24. * scale).min(if self.hosted { 480. } else { f32::INFINITY });
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
        let input_height = label * 1.4 + 20. * scale + if self.hosted { 2. } else { 4. };
        let button_height = label * 1.4 + 16. * scale;
        let height = logo_size
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
            egui::pos2(rect.center().x, y + logo_size / 2.),
            egui::vec2(logo_size, logo_size),
        );
        egui::Image::new(egui::include_image!("../../assets/icons/auth.svg"))
            .tint(p.primary)
            .paint_at(ui, logo);
        y += logo_size + 4. * scale;
        let title_galley = text_galley(
            ui,
            "Connect to Canvas",
            title,
            title * 1.35,
            if self.hosted { "bold" } else { "semibold" },
            width,
            1,
            title_color,
            false,
        );
        ui.painter().galley(
            egui::pos2(rect.center().x - title_galley.size().x / 2., y),
            title_galley,
            title_color,
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
                if self.hosted { 10 } else { 100 },
                p.card,
                egui::Stroke::new(
                    if self.hosted {
                        1_f32
                    } else if self.error.is_some() {
                        2.
                    } else {
                        0.
                    },
                    if self.hosted {
                        Color32::from_rgb(191, 212, 199)
                    } else {
                        p.error
                    },
                ),
                egui::StrokeKind::Inside,
            );
            let response = ui.put(
                input,
                egui::TextEdit::singleline(&mut self.auth_url)
                    .interactive(!self.auth_waiting)
                    .frame(false)
                    .hint_text(RichText::new("canvas.edu").color(if self.hosted {
                        Color32::from_rgb(82, 107, 96)
                    } else {
                        p.muted
                    }))
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
            painter.rect_filled(button, if self.hosted { 10 } else { 100 }, p.success);
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
            action_ui.set_clip_rect(action_ui.clip_rect().intersect(egui::Rect::from_min_size(
                start - egui::vec2(width * progress, 0.),
                egui::vec2(width, 150. * (1. - progress)),
            )));
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
        let wrapper_clip = egui::Rect::from_min_size(
            start - egui::vec2(width * progress, 0.),
            egui::vec2(width, 150. * (1. - progress)),
        );
        if item.is_custom {
            card_ui.set_clip_rect(card_ui.clip_rect().intersect(wrapper_clip));
        }
        if state.deleting.is_some() {
            card_ui.set_opacity(1. - progress);
            card_ui.disable();
        }
        let (mut background, background_index, zoom_rect) = self.card_foreground(&mut card_ui, item);
        let frame_rect = background.rect;

        state.height = frame_rect.height();
        let height = if item.is_custom {
            state.height.min(150. * (1. - progress))
        } else {
            state.height
        };
        slot.set_height(height.max(0.));
        ui.advance_cursor_after_rect(slot);
        let response = ui.interact(
            if item.is_custom {
                frame_rect.intersect(wrapper_clip)
            } else {
                frame_rect
            },
            ui.id().with(("card-click", &item.id)),
            if item.is_custom {
                egui::Sense::click_and_drag()
            } else {
                egui::Sense::click()
            },
        );
        let hover = ui.ctx().animate_bool_with_time(
            egui::Id::new(("card-hover", &item.id)),
            response.hovered(),
            0.16,
        );
        background.fill = background.fill.lerp_to_gamma(Color32::GRAY, hover * 0.10);
        card_ui.painter().set(background_index, background);
        let open_zoom = zoom_rect.is_some_and(|rect| {
            let rect = if item.is_custom {
                rect.intersect(wrapper_clip)
            } else {
                rect
            };
            rect.is_positive()
                && ui
                    .interact(rect, ui.id().with(("zoom", &item.id)), egui::Sense::click())
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
                let mut filters = egui::ScrollArea::horizontal()
                    .scroll_source(egui::scroll_area::ScrollSource {
                        mouse_wheel: false,
                        ..Default::default()
                    })
                    .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
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
                                let font = if self.settings.size == "Small" {
                                    8.
                                } else if cfg!(target_os = "linux") {
                                    12. * scale
                                } else {
                                    11.
                                };
                                let line = font * 1.4;
                                let color = if selected {
                                    Color32::BLACK
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
                if ui.input(|input| {
                    input
                        .pointer
                        .hover_pos()
                        .is_some_and(|point| filters.inner_rect.contains(point))
                }) {
                    let delta = ui.input_mut(|input| {
                        let delta = input.raw_scroll_delta;
                        input.raw_scroll_delta = egui::Vec2::ZERO;
                        input.smooth_scroll_delta = egui::Vec2::ZERO;
                        if delta.y != 0. {
                            -40. * delta.y.signum()
                        } else {
                            -delta.x
                        }
                    });
                    if delta != 0. {
                        filters.state.offset.x = (filters.state.offset.x + delta).clamp(
                            0.,
                            (filters.content_size.x - filters.inner_rect.width()).max(0.),
                        );
                        filters.state.store(ui.ctx(), filters.id);
                        ui.ctx().request_repaint();
                    }
                }
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
            let bottom = self.body_bottom(ui.ctx());
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
            (12.) * scale
        } else if small {
            9.
        } else {
            11.
        };
        let meta_line = if linux {
            meta * 1.4
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
        let track_y =
            start.y + 12. + label_line + 4. + description.rows.len() as f32 * body_line + 12.;
        let track_h = meta_line + if linux { 24. } else { 20. } + if self.hosted { 2. } else { 0. };
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
        ui.painter().rect(
            track,
            12,
            if self.hosted {
                Color32::from_rgb(224, 238, 229)
            } else {
                p.background
            },
            egui::Stroke::new(if self.hosted { 1_f32 } else { 0. }, p.outline),
            egui::StrokeKind::Inside,
        );
        let track_inset = if self.hosted { 5. } else { 4. };
        let slot_width = (inner - 2. * track_inset) / 3.;
        let index = ["Small", "Medium", "Large"]
            .iter()
            .position(|v| *v == self.settings.size)
            .unwrap_or(1);
        let animated =
            ui.ctx()
                .animate_value_with_time(egui::Id::new("settings-pill"), index as f32, 0.3);
        if self.hosted {
            let pill = egui::Rect::from_min_size(
                track.min + egui::vec2(track_inset + slot_width * animated, track_inset),
                egui::vec2(slot_width, track_h - 2. * track_inset),
            );
            ui.painter().add(
                egui::epaint::Shadow {
                    offset: [0, 2],
                    blur: 7,
                    spread: 0,
                    color: Color32::from_rgba_unmultiplied(0, 107, 95, 24),
                }
                .as_shape(pill, 12),
            );
        }
        ui.painter().rect_filled(
            egui::Rect::from_min_size(
                track.min + egui::vec2(track_inset + slot_width * animated, track_inset),
                egui::vec2(slot_width, track_h - 2. * track_inset),
            ),
            12,
            p.success,
        );
        for (index, size) in ["Small", "Medium", "Large"].iter().enumerate() {
            let slot = egui::Rect::from_min_size(
                track.min + egui::vec2(track_inset + index as f32 * slot_width, track_inset),
                egui::vec2(slot_width, track_h - 2. * track_inset),
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
        let text_height = launch_title.rows.len() as f32 * label_line
            + 4.
            + launch_sub.rows.len() as f32 * body_line;
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
                if self.hosted { 10 } else { 8 },
                if self.hosted { p.card } else { p.background },
                egui::Stroke::new(
                    1_f32,
                    if self.hosted {
                        Color32::from_rgb(191, 212, 199)
                    } else {
                        p.outline
                    },
                ),
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
            egui::pos2(start.x + 12., y + label_line + 4.),
            launch_sub,
            p.muted,
        );
        let mut startup = self.startup_enabled;
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
            if startup {
                p.success
            } else if self.hosted {
                Color32::from_rgb(224, 238, 229)
            } else {
                p.background
            },
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
            self.startup_enabled = startup;
            if let Err(error) = set_startup(startup) {
                self.error = Some(error.to_string());
            }
        }
        let footer_height = meta_line + 12. + 24.;
        let footer_y = (self.body_bottom(ui.ctx()) - 4. - footer_height).max(second.bottom() + 12.);
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
            Color32::BLACK,
            false,
        );
        let button = egui::Rect::from_min_size(
            footer.min + egui::vec2(12., 12.),
            text.size() + egui::vec2(24., 12.),
        );
        let mut sync_painter = ui.painter().clone();
        if syncing {
            sync_painter.set_opacity(0.7);
        }
        sync_painter.rect_filled(button, 100, p.success);
        sync_painter.galley(button.min + egui::vec2(12., 6.), text, Color32::BLACK);
        if ui
            .interact(
                button,
                ui.id().with("force-sync"),
                if syncing {
                    egui::Sense::hover()
                } else {
                    egui::Sense::click()
                },
            )
            .clicked()
            && !syncing
            && self.session.is_some()
            && !self.reconnect_required
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
        if ui.input(|input| input.key_pressed(egui::Key::Escape)) {
            form.error = None;
        }
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
        let mut picker_clicked = false;
        for (index, (value, placeholder)) in [
            (&mut form.title, "Title"),
            (&mut form.course, "Course"),
            (&mut form.estimate, "Time Estimate (e.g. 30m)"),
            (&mut form.date, "mm/dd/yyyy, --:-- --"),
        ]
        .into_iter()
        .enumerate()
        {
            let rect = egui::Rect::from_min_size(
                start + egui::vec2(0., index as f32 * (height + 6.)),
                egui::vec2(width, height + if index == 3 { 2. } else { 0. }),
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
                    .hint_text(RichText::new(placeholder).color(if index == 3 {
                        p.text
                    } else if self.hosted {
                        Color32::from_rgb(82, 107, 96)
                    } else {
                        Color32::from_gray(117)
                    }))
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
                    egui::pos2(rect.right() - 30., rect.center().y - 10.),
                    egui::vec2(20., 20.),
                );
                egui::Image::new(egui::include_image!("../../assets/icons/schedule.svg"))
                    .tint(p.text)
                    .paint_at(ui, icon.shrink(3.));
                if ui
                    .interact(icon, ui.id().with("task-date"), egui::Sense::click())
                    .clicked()
                {
                    picker_clicked = true;
                }
            }
        }
        if picker_clicked {
            if form.picker_open {
                form.picker_open = false;
            } else {
                form.open_date_picker();
            }
        }
        let button = egui::Rect::from_min_size(
            egui::pos2(start.x, start.y + 4. * height + 3. * 6. + 20.),
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
            Color32::BLACK,
            false,
        );
        ui.painter()
            .galley(button.center() - text.size() / 2., text, Color32::BLACK);
        let submit = ui
            .interact(button, ui.id().with("add-task"), egui::Sense::click())
            .clicked()
            || (responses.iter().any(|r| r.lost_focus())
                && ui.input(|i| i.key_pressed(egui::Key::Enter)));
        if submit && !form.picker_open {
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
                    due_date: Some(
                        deadline
                            .with_timezone(&Utc)
                            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    ),
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
            responses[index].request_focus();
            let field = egui::Rect::from_min_size(
                start + egui::vec2(0., index as f32 * (height + 6.)),
                egui::vec2(width, height + if index == 3 { 2. } else { 0. }),
            );
            if self.hosted {
                ui.painter().rect_stroke(
                    field.expand(3.),
                    17,
                    egui::Stroke::new(2_f32, p.primary),
                    egui::StrokeKind::Outside,
                );
            } else {
                ui.painter().rect_stroke(
                    field,
                    14,
                    egui::Stroke::new(2_f32, Color32::from_rgb(229, 151, 0)),
                    egui::StrokeKind::Outside,
                );
                ui.painter().rect_stroke(
                    field,
                    14,
                    egui::Stroke::new(1_f32, Color32::WHITE),
                    egui::StrokeKind::Outside,
                );
            }
            let maximum_width = (viewport.width() / 2. - 4.).max(96.);
            let message = text_galley(
                ui,
                "Please fill out this field.",
                14.,
                20.3,
                "picker-regular",
                maximum_width - 48.,
                usize::MAX,
                Color32::BLACK,
                false,
            );
            let multiple = message.rows.len() > 1;
            let width = if multiple {
                maximum_width
            } else {
                message.size().x + 48.
            };
            let tooltip_height = if multiple { 62. } else { 44. };
            let position = egui::pos2(field.center().x - width / 2., field.bottom() + 8.);
            egui::Area::new(ui.id().with("required-field"))
                .order(egui::Order::Tooltip)
                .constrain(false)
                .fixed_pos(position)
                .show(ui.ctx(), |ui| {
                    let rect =
                        egui::Rect::from_min_size(position, egui::vec2(width, tooltip_height));
                    ui.set_min_size(rect.size());
                    ui.painter().add(
                        egui::epaint::Shadow {
                            offset: [0, 2],
                            blur: 4,
                            spread: 0,
                            color: Color32::from_black_alpha(64),
                        }
                        .as_shape(rect, 2),
                    );
                    ui.painter().rect(
                        rect,
                        2,
                        Color32::from_gray(250),
                        egui::Stroke::new(1_f32, Color32::from_gray(160)),
                        egui::StrokeKind::Inside,
                    );
                    let arrow = position + egui::vec2(17., 0.);
                    ui.painter().add(egui::Shape::convex_polygon(
                        vec![
                            arrow - egui::vec2(7., 0.),
                            arrow - egui::vec2(0., 7.),
                            arrow + egui::vec2(7., 0.),
                        ],
                        Color32::from_gray(250),
                        egui::Stroke::new(1_f32, Color32::from_gray(160)),
                    ));
                    let symbol = egui::Rect::from_min_size(
                        position + egui::vec2(9., 8.),
                        egui::vec2(22., 24.),
                    );
                    ui.painter()
                        .rect_filled(symbol, 2, Color32::from_rgb(255, 145, 0));
                    let mark = text_galley(
                        ui,
                        "!",
                        18.,
                        24.,
                        "picker-bold",
                        22.,
                        1,
                        Color32::WHITE,
                        false,
                    );
                    ui.painter()
                        .galley(symbol.center() - mark.size() / 2., mark, Color32::WHITE);
                    ui.painter()
                        .galley(position + egui::vec2(39., 8.), message, Color32::BLACK);
                });
        }
        form.date_popup(
            ui.ctx(),
            egui::Rect::from_min_size(
                start + egui::vec2(0., 3. * (height + 6.)),
                egui::vec2(width, height + 2.),
            ),
        );
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
            (12.) * scale
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
                let icon = if direction < 0 {
                    egui::include_image!("../../assets/icons/chevron-left.svg")
                } else {
                    egui::include_image!("../../assets/icons/chevron-right.svg")
                };
                egui::Image::new(icon).tint(p.text).paint_at(
                    ui,
                    egui::Rect::from_center_size(center, egui::vec2(14., 14.)),
                );
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
            let weekday_width = grid_width / 7.;
            let weekday_y = header.bottom() + 8.;
            for (i, day) in ["S", "M", "T", "W", "T", "F", "S"].iter().enumerate() {
                let text = text_galley(
                    ui,
                    day,
                    metadata,
                    metadata * 1.4,
                    "medium",
                    weekday_width,
                    1,
                    p.text.gamma_multiply(0.5),
                    false,
                );
                ui.painter().galley(
                    egui::pos2(
                        grid_start.x + (i as f32 + 0.5) * weekday_width - text.size().x / 2.,
                        weekday_y,
                    ),
                    text,
                    p.text,
                );
            }
            // CSS grid gaps reduce each column before max-width constrains the circle.
            let cell_width = (grid_width - 12.) / 7.;
            let diameter = (if cfg!(target_os = "linux") {
                28. * scale
            } else {
                20.
            })
            .min(cell_width);
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
                    grid_start.x + (cell % 7) as f32 * (cell_width + 2.) + cell_width / 2.,
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
                let y = grid.bottom() + 24.;
                ui.painter()
                    .hline(grid.x_range(), y + 0.5, egui::Stroke::new(1_f32, p.outline));
                ui.advance_cursor_after_rect(egui::Rect::from_min_max(
                    grid.min,
                    egui::pos2(grid.right(), y + 1.),
                ));
            }
        }
        if let Some(day) = self.selected_day {
            let start = ui.next_widget_position();
            let left = if small { start.x } else { grid_start.x };
            let right = if small {
                ui.max_rect().right()
            } else {
                grid_start.x + grid_width
            };
            let header_width = right - left;
            let top = start.y;
            let meta_line = metadata * 1.4;
            let mut details = ui.new_child(egui::UiBuilder::new().id_salt("day-detail").max_rect(
                egui::Rect::from_min_size(
                    egui::pos2(left, top),
                    egui::vec2(header_width, f32::INFINITY),
                ),
            ));
            let (header, response) = details.allocate_exact_size(
                egui::vec2(header_width, meta_line + 8.),
                egui::Sense::click(),
            );
            let image = if small {
                egui::include_image!("../../assets/icons/chevron-left.svg")
            } else {
                egui::include_image!("../../assets/icons/close.svg")
            };
            egui::Image::new(image).tint(p.primary).paint_at(
                &details,
                egui::Rect::from_center_size(
                    header.left_center() + egui::vec2(7., 0.),
                    egui::vec2(14., 14.),
                ),
            );
            paint_text(
                &details,
                egui::pos2(header.left() + 18., header.top() + 4.),
                &day.format("%a, %b %-d").to_string(),
                metadata,
                meta_line,
                "bold",
                header_width - 18.,
                p.primary,
            );
            if response.clicked() {
                self.selected_day = None;
                self.archive.clear();
                self.card_states.clear();
            }
            let content_top = header.bottom() + 4.;
            let content_rect = egui::Rect::from_min_size(
                egui::pos2(left, content_top),
                egui::vec2(header_width - 4., f32::INFINITY),
            );
            let mut content = details.new_child(
                egui::UiBuilder::new()
                    .id_salt("day-content")
                    .max_rect(content_rect),
            );
            let name = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
                [day.weekday().num_days_from_sunday() as usize];
            let classes: Vec<_> = parsed_courses
                .iter()
                .filter(|c| c.day == name)
                .cloned()
                .collect();
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
            if !classes.is_empty() {
                let label = egui::Rect::from_min_size(
                    content.next_widget_position(),
                    egui::vec2(content.available_width(), meta_line),
                );
                paint_text(
                    &content,
                    label.min + egui::vec2(4., 0.),
                    "Classes",
                    metadata,
                    meta_line,
                    "bold",
                    label.width() - 4.,
                    p.primary,
                );
                let mut reserved = label;
                reserved.max.y -= 4.;
                content.advance_cursor_after_rect(reserved);
                for course in &classes {
                    self.course_card(&mut content, course, true);
                }
                content.add_space(12.);
            }
            if classes.is_empty() && items.is_empty() {
                let text = text_galley(
                    &content,
                    "No tasks or classes.",
                    14. * scale,
                    19.6 * scale,
                    "regular",
                    content.available_width(),
                    usize::MAX,
                    p.muted,
                    false,
                );
                let rect = egui::Rect::from_min_size(
                    content.next_widget_position() + egui::vec2(0., 20.),
                    egui::vec2(content.available_width(), text.size().y),
                );
                content.painter().galley(
                    egui::pos2(rect.center().x - text.size().x / 2., rect.top()),
                    text,
                    p.muted,
                );
                content.advance_cursor_after_rect(rect);
            }
            for item in items {
                self.card(&mut content, &item);
            }
            let bottom = content.min_rect().bottom().max(header.bottom());
            ui.advance_cursor_after_rect(egui::Rect::from_min_max(
                egui::pos2(left, top),
                egui::pos2(right, bottom),
            ));
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
            let y = (self.body_bottom(ui.ctx()) - 4. - height).max(ui.min_rect().bottom() + 4.);
            let mut right = grid_start.x + grid_width;
            for (label, schedule) in [("Import", false), ("Schedule", true)] {
                let color = if schedule { p.primary } else { Color32::BLACK };
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
    fn course_card(&self, ui: &mut egui::Ui, course: &Course, detail: bool) {
        let p = self.palette();
        let linux = cfg!(target_os = "linux");
        let scale = if linux {
            self.settings.text_scale()
        } else {
            1.
        };
        let meta = if linux { 12. } else { 11. } * scale;
        let line = meta * 1.4;
        let body_line = meta * 1.4;
        let code_size = if detail {
            if linux { 13. } else { 12. }
        } else {
            14.
        } * scale;
        let code_line = code_size * 1.4;
        let (px, py, gap) = if detail { (10., 6., 2.) } else { (12., 8., 4.) };
        let start = ui.next_widget_position();
        let width = ui.available_width();
        let inner = width - 2. * px;
        let online = course
            .is_online
            .then(|| text_galley(ui, "Online", meta, line, "medium", inner, 1, p.error, false));
        let time = text_galley(
            ui,
            &course.time_slot,
            meta,
            line,
            "medium",
            inner - online.as_ref().map(|v| v.size().x + 8.).unwrap_or(0.),
            usize::MAX,
            p.primary,
            false,
        );
        let row_height = (time.rows.len() as f32 * line).max(line);
        let code = text_galley(
            ui,
            &course.course_code,
            code_size,
            code_line,
            "semibold",
            inner,
            usize::MAX,
            p.text,
            false,
        );
        let code_height = code.rows.len() as f32 * code_line;
        let secondary = if self.hosted {
            p.muted
        } else {
            Color32::from_rgb(204, 194, 220)
        };
        let description = if detail {
            format!(
                "{}{}",
                course.venue,
                if course.teacher.is_empty() {
                    String::new()
                } else {
                    format!(" • {}", course.teacher)
                }
            )
        } else {
            course.course_title.clone()
        };
        let description = text_galley(
            ui,
            &description,
            meta,
            body_line,
            "regular",
            inner,
            usize::MAX,
            secondary,
            false,
        );
        let description_height = description.rows.len() as f32 * body_line;
        let mut height = 2. * py + row_height + gap + code_height + gap + description_height;
        let mut tags = Vec::new();
        if !detail {
            let mut x = 0.;
            let mut row_y = 0.;
            for label in [&course.venue, &course.teacher] {
                let text = text_galley(
                    ui,
                    label,
                    meta,
                    body_line,
                    "regular",
                    inner - 12.,
                    usize::MAX,
                    secondary,
                    false,
                );
                let size = text.size() + egui::vec2(12., 4.);
                if x > 0. && x + size.x > inner {
                    x = 0.;
                    row_y += body_line + 8.;
                }
                tags.push((egui::vec2(x, row_y), size, text));
                x += size.x + 4.;
            }
            height += 8. + row_y + body_line + 4.;
        }
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());
        ui.painter().rect_filled(rect, 12, p.card);
        ui.painter()
            .galley(start + egui::vec2(px, py), time, p.primary);
        if let Some(online) = online {
            ui.painter().galley(
                egui::pos2(rect.right() - px - online.size().x, start.y + py),
                online,
                p.error,
            );
        }
        ui.painter()
            .galley(start + egui::vec2(px, py + row_height + gap), code, p.text);
        ui.painter().galley(
            start + egui::vec2(px, py + row_height + gap + code_height + gap),
            description,
            secondary,
        );
        let tags_top = py + row_height + gap + code_height + gap + description_height + 8.;
        for (offset, size, text) in tags {
            let chip = egui::Rect::from_min_size(start + egui::vec2(px, tags_top) + offset, size);
            ui.painter().rect_filled(chip, 14, p.background);
            ui.painter()
                .galley(chip.min + egui::vec2(6., 2.), text, secondary);
        }
        if detail {
            ui.add_space(-4.);
        }
    }
    fn schedule_screen(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let linux = cfg!(target_os = "linux");
        let scale = if linux {
            self.settings.text_scale()
        } else {
            1.
        };
        let meta = (if linux { 12. } else { 11. }) * scale;
        let meta_line = meta * 1.4;
        let title_size = (if linux { 16. } else { 14. }) * scale;
        let title_line = title_size * 1.35;
        let secondary = if self.hosted {
            p.muted
        } else {
            Color32::from_rgb(204, 194, 220)
        };
        let start = ui.next_widget_position() + egui::vec2(4., 4.);
        let width = ui.available_width() - 8.;
        let bottom = self.body_bottom(ui.ctx()) - 4.;
        let count = schedule::parse(&self.schedule_text).len();
        let natural_title = text_galley(
            ui,
            "Smart Import",
            title_size,
            title_line,
            "semibold",
            f32::INFINITY,
            1,
            p.primary,
            false,
        );
        let title_width = natural_title.size().x;
        let count_label = format!("{count} detected");
        let natural_count = (count > 0).then(|| {
            text_galley(
                ui,
                &count_label,
                meta,
                meta_line,
                "medium",
                f32::INFINITY,
                1,
                secondary,
                false,
            )
        });
        let count_width = natural_count
            .as_ref()
            .map(|text| text.size().x)
            .unwrap_or(0.);
        let available = width - 8.;
        let left_basis = 34. + title_width;
        let deficit = (left_basis + count_width - available).max(0.);
        let left_width = left_basis - deficit * left_basis / (left_basis + count_width);
        let import_title = if deficit == 0. {
            natural_title
        } else {
            text_galley(
                ui,
                "Smart Import",
                title_size,
                title_line,
                "semibold",
                left_width - 34.,
                usize::MAX,
                p.primary,
                false,
            )
        };
        let import_count = natural_count.map(|natural| {
            if deficit == 0. {
                natural
            } else {
                text_galley(
                    ui,
                    &count_label,
                    meta,
                    meta_line,
                    "medium",
                    (available - left_width).max(1.),
                    usize::MAX,
                    secondary,
                    false,
                )
            }
        });
        let header_height = if self.import_schedule {
            (meta_line + 10.).max(title_line)
        } else {
            26_f32
                .max(import_title.size().y)
                .max(import_count.as_ref().map(|g| g.size().y).unwrap_or(0.))
        };
        let header = egui::Rect::from_min_size(start, egui::vec2(width, header_height));
        if self.import_schedule {
            paint_text(
                ui,
                header.min + egui::vec2(4., (header_height - title_line) / 2.),
                "Your Schedule",
                title_size,
                title_line,
                "semibold",
                width - 80.,
                p.primary,
            );
            let text = text_galley(
                ui, "Back", meta, meta_line, "medium", width, 1, secondary, false,
            );
            let back = egui::Rect::from_min_size(
                egui::pos2(header.right() - 4. - text.size().x - 18., header.top()),
                egui::vec2(text.size().x + 18., header_height),
            );
            ui.painter().rect_stroke(
                back,
                100,
                egui::Stroke::new(1_f32, p.outline),
                egui::StrokeKind::Inside,
            );
            ui.painter()
                .galley(back.center() - text.size() / 2., text, secondary);
            if ui
                .interact(back, ui.id().with("schedule-back"), egui::Sense::click())
                .clicked()
            {
                self.import_open = false;
            }
            let day_height = meta_line + 14.;
            let days_rect = egui::Rect::from_min_size(
                header.left_bottom() + egui::vec2(0., 8.),
                egui::vec2(width, day_height + 8.),
            );
            let mut days_ui = ui.new_child(
                egui::UiBuilder::new()
                    .id_salt("schedule-days")
                    .max_rect(days_rect.shrink(4.)),
            );
            egui::ScrollArea::horizontal()
                .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
                .show(&mut days_ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 4.;
                        for (index, day) in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
                            .iter()
                            .enumerate()
                        {
                            let selected = self.import_day == index;
                            let color = if selected { Color32::BLACK } else { secondary };
                            let text = text_galley(
                                ui,
                                day,
                                meta,
                                meta_line,
                                if selected { "bold" } else { "regular" },
                                width,
                                1,
                                color,
                                false,
                            );
                            let (rect, response) = ui.allocate_exact_size(
                                egui::vec2(
                                    text.size().x + if selected { 20. } else { 22. },
                                    day_height,
                                ),
                                egui::Sense::click(),
                            );
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
                                self.import_day = index;
                            }
                        }
                    });
                });
            let list = egui::Rect::from_min_max(
                days_rect.left_bottom() + egui::vec2(4., 12.),
                egui::pos2(header.right() - 4., bottom - 4.),
            );
            let mut list_ui = ui.new_child(
                egui::UiBuilder::new()
                    .id_salt("schedule-list")
                    .max_rect(list),
            );
            let day = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][self.import_day];
            let mut courses: Vec<_> = schedule::parse(&self.schedule_text)
                .into_iter()
                .filter(|c| c.day == day)
                .collect();
            courses.sort_by_key(|c| {
                chrono::NaiveTime::parse_from_str(
                    c.time_slot.split('-').next().unwrap_or("").trim(),
                    "%I:%M%p",
                )
                .ok()
            });
            egui::ScrollArea::vertical()
                .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
                .max_height(list.height().max(40.))
                .auto_shrink([false, false])
                .show(&mut list_ui, |ui| {
                    if courses.is_empty() {
                        let text = text_galley(
                            ui,
                            "No classes on this day.",
                            14. * scale,
                            19.6 * scale,
                            "regular",
                            list.width(),
                            usize::MAX,
                            p.muted,
                            false,
                        );
                        ui.painter().galley(
                            egui::pos2(list.center().x - text.size().x / 2., list.top() + 20.),
                            text,
                            p.muted,
                        );
                    }
                    for course in courses {
                        self.course_card(ui, &course, false);
                    }
                });
        } else {
            let back = egui::Rect::from_min_size(
                header.min + egui::vec2(4., (header.height() - 26.) / 2.),
                egui::vec2(26., 26.),
            );
            egui::Image::new(egui::include_image!("../../assets/icons/chevron-left.svg"))
                .tint(secondary)
                .paint_at(ui, back.shrink(4.));
            if ui
                .interact(back, ui.id().with("import-back"), egui::Sense::click())
                .clicked()
            {
                self.import_open = false;
            }
            ui.painter().galley(
                egui::pos2(
                    back.right() + 8.,
                    header.center().y - import_title.size().y / 2.,
                ),
                import_title,
                p.primary,
            );
            if let Some(text) = import_count {
                let count_box_width = if deficit == 0. {
                    text.size().x
                } else {
                    (available - left_width).max(1.)
                };
                ui.painter().galley(
                    egui::pos2(
                        header.right() - 4. - count_box_width,
                        header.center().y - text.size().y / 2.,
                    ),
                    text,
                    secondary,
                );
            }
            let button_size = (if linux { 13. } else { 12. }) * scale;
            let button_line = button_size * 1.4;
            let footer_height = button_line + 16.;
            let footer = egui::Rect::from_min_size(
                egui::pos2(start.x + 4., bottom - footer_height),
                egui::vec2(width - 8., footer_height),
            );
            let textarea = egui::Rect::from_min_max(
                header.left_bottom() + egui::vec2(0., 12.),
                egui::pos2(header.right(), footer.top() - 12.),
            );
            ui.painter().rect(
                textarea,
                16,
                p.card,
                egui::Stroke::new(1_f32, p.outline),
                egui::StrokeKind::Inside,
            );
            let inner = textarea.shrink(1.);
            let mut input_ui = ui.new_child(
                egui::UiBuilder::new()
                    .id_salt("schedule-input")
                    .max_rect(inner),
            );
            let font = (if linux { 14. } else { 12. }) * scale;
            let line = if linux { 19.6 * scale } else { 16. };
            let family = if self.hosted {
                egui::FontFamily::Proportional
            } else {
                egui::FontFamily::Monospace
            };
            let mut layouter = |ui: &egui::Ui, text: &dyn egui::TextBuffer, _: f32| {
                schedule_galley(
                    ui,
                    text.as_str(),
                    egui::FontId::new(font, family.clone()),
                    line,
                    p.text,
                )
            };
            let mut focused = false;
            let home = ui
                .ctx()
                .data_mut(|data| data.remove_temp::<bool>(egui::Id::new("schedule-scroll-home")))
                .unwrap_or(false)
                || ui.memory(|memory| memory.has_focus(egui::Id::new("schedule-text")))
                    && ui.input(|input| input.modifiers.ctrl && input.key_pressed(egui::Key::Home));
            let mut input_scroll = egui::ScrollArea::both()
                .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
                .auto_shrink([false, false])
                .max_height(inner.height().max(20.));
            if home {
                input_scroll = input_scroll.horizontal_scroll_offset(12.);
            }
            input_scroll.show(&mut input_ui, |ui| {
                focused = ui
                    .add(
                        egui::TextEdit::multiline(&mut self.schedule_text)
                            .id(egui::Id::new("schedule-text"))
                            .frame(false)
                            .font(egui::FontId::new(font, family.clone()))
                            .hint_text(RichText::new("Paste schedule table...").color(
                                if self.hosted {
                                    Color32::from_rgb(82, 107, 96)
                                } else {
                                    Color32::from_gray(117)
                                },
                            ))
                            .margin(egui::vec2(12., 12.))
                            .layouter(&mut layouter)
                            .desired_width(inner.width() - 24.),
                    )
                    .has_focus();
            });
            if focused {
                ui.painter().rect_stroke(
                    textarea,
                    16,
                    egui::Stroke::new(1_f32, p.primary),
                    egui::StrokeKind::Inside,
                );
            }
            if let Some(status) = &self.import_status {
                paint_text(
                    ui,
                    egui::pos2(footer.left(), footer.center().y - meta_line / 2.),
                    status,
                    meta,
                    meta_line,
                    "medium",
                    footer.width() - 80.,
                    if status == "Saved!" {
                        p.primary
                    } else {
                        p.error
                    },
                );
            } else if count > 0 {
                let text = text_galley(
                    ui,
                    "View",
                    meta,
                    meta_line,
                    "medium",
                    footer.width(),
                    1,
                    p.primary,
                    false,
                );
                let view = egui::Rect::from_center_size(
                    egui::pos2(
                        footer.left() + (text.size().x + 26.) / 2.,
                        footer.center().y,
                    ),
                    text.size() + egui::vec2(26., 14.),
                );
                ui.painter().rect_stroke(
                    view,
                    100,
                    egui::Stroke::new(1_f32, p.primary),
                    egui::StrokeKind::Inside,
                );
                ui.painter()
                    .galley(view.center() - text.size() / 2., text, p.primary);
                if ui
                    .interact(view, ui.id().with("view-schedule"), egui::Sense::click())
                    .clicked()
                {
                    self.import_schedule = true;
                }
            }
            let text = text_galley(
                ui,
                "Save",
                button_size,
                button_line,
                "semibold",
                footer.width(),
                1,
                Color32::BLACK,
                false,
            );
            let save = egui::Rect::from_min_size(
                egui::pos2(footer.right() - text.size().x - 32., footer.top()),
                egui::vec2(text.size().x + 32., footer.height()),
            );
            ui.painter().rect_filled(save, 100, p.success);
            ui.painter()
                .galley(save.center() - text.size() / 2., text, Color32::BLACK);
            if ui
                .interact(save, ui.id().with("save-schedule"), egui::Sense::click())
                .clicked()
            {
                self.save_schedule();
            }
        }
        ui.advance_cursor_after_rect(egui::Rect::from_min_max(
            start,
            egui::pos2(start.x + width, bottom),
        ));
    }
    fn start_model_pull(&mut self) {
        self.ai_pulling = true;
        self.ai_progress = 0;
        let tx = self.tx.clone();
        let generation = self.ai_generation;
        self.rt.spawn(async move {
            let progress_tx = tx.clone();
            let result = Ollama::default()
                .pull(move |p| {
                    let _ = progress_tx.send(Event::Pull(generation, p));
                })
                .await
                .map_err(|e| e.to_string());
            let _ = tx.send(Event::PullDone(generation, result));
        });
    }
    fn ai_setup(&mut self, ui: &mut egui::Ui) {
        let p = self.palette();
        let rect = ui.max_rect();
        let linux = cfg!(target_os = "linux");
        let compact = self.settings.size == "Small";
        let scale = if linux {
            self.settings.text_scale()
        } else {
            1.
        };
        let body = 14. * scale;
        let body_line = if linux { 20.3 * scale } else { 18. };
        let title_size = (if linux { 18. } else { 16. }) * scale;
        let title_line = if linux { title_size * 1.3 } else { 20. };
        let meta = (if linux {
            12.
        } else if compact {
            9.
        } else {
            11.
        }) * scale;
        let meta_line = if linux {
            meta * 1.4
        } else if compact {
            12.
        } else {
            14.
        };
        if self.ai_checking {
            let text = text_galley(
                ui,
                "Checking AI connection...",
                body,
                body_line,
                "regular",
                rect.width(),
                usize::MAX,
                p.muted,
                false,
            );
            ui.painter()
                .galley(rect.center() - text.size() / 2., text, p.muted);
            return;
        }
        if self.ai_pulling {
            let title = text_galley(
                ui,
                "Downloading Model...",
                title_size,
                title_line,
                "semibold",
                rect.width(),
                usize::MAX,
                p.text,
                false,
            );
            let title_height = title.rows.len() as f32 * title_line;
            let bar_gap = if compact { 20. } else { 28. };
            let height = title_height + bar_gap + 8. + 20. + meta_line;
            let y = rect.center().y - height / 2.;
            ui.painter().galley(
                egui::pos2(rect.center().x - title.size().x / 2., y),
                title,
                p.text,
            );
            let track = egui::Rect::from_min_size(
                egui::pos2(rect.left() + rect.width() * 0.1, y + title_height + bar_gap),
                egui::vec2(rect.width() * 0.8, 8.),
            );
            ui.painter().rect_filled(track, 4, p.background);
            let mut progress = track;
            let percent = ui.ctx().animate_value_with_time(
                ui.id().with(("pull-progress", self.ai_generation)),
                self.ai_progress as f32,
                0.2,
            );
            progress.set_width(track.width() * percent / 100.);
            ui.painter().rect_filled(progress, 4, p.primary);
            let label = text_galley(
                ui,
                &format!("{}%", self.ai_progress),
                meta,
                meta_line,
                "medium",
                rect.width(),
                1,
                p.primary,
                false,
            );
            ui.painter().galley(
                egui::pos2(rect.center().x - label.size().x / 2., track.bottom() + 20.),
                label,
                p.primary,
            );
            return;
        }
        let title = text_galley(
            ui,
            if self.ai_online {
                "Model Required"
            } else {
                "Ollama Not Found"
            },
            title_size,
            title_line,
            "semibold",
            rect.width(),
            usize::MAX,
            p.text,
            false,
        );
        let title_height = title.rows.len() as f32 * title_line;
        let description = if compact {
            None
        } else {
            Some(text_galley(
                ui,
                if self.ai_online {
                    "The qwen2.5:3b model is required for AI Chat."
                } else {
                    "Please install and run Ollama locally on port 11434."
                },
                body,
                body_line,
                "regular",
                rect.width(),
                usize::MAX,
                p.muted,
                false,
            ))
        };
        let description_height = description
            .as_ref()
            .map(|v| v.rows.len() as f32 * body_line)
            .unwrap_or(0.);
        let button_height = meta_line + 8. + if self.ai_online { 0. } else { 2. };
        let button_gap = if compact { 16. } else { 24. };
        let icon_size = if compact { 32. } else { 48. };
        let height = icon_size
            + 12.
            + title_height
            + if compact {
                0.
            } else {
                12. + description_height
            }
            + button_gap
            + button_height;
        let mut y = rect.center().y - height / 2.;
        let icon = if self.ai_online {
            egui::include_image!("../../assets/icons/download.svg")
        } else {
            egui::include_image!("../../assets/icons/offline.svg")
        };
        egui::Image::new(icon)
            .tint(if self.ai_online { p.primary } else { p.error })
            .paint_at(
                ui,
                egui::Rect::from_min_size(
                    egui::pos2(rect.center().x - icon_size / 2., y),
                    egui::vec2(icon_size, icon_size),
                ),
            );
        y += icon_size + 12.;
        ui.painter().galley(
            egui::pos2(rect.center().x - title.size().x / 2., y),
            title,
            p.text,
        );
        y += title_height;
        if let Some(mut description) = description {
            y += 12.;
            let width = description.size().x;
            for row in &mut Arc::make_mut(&mut description).rows {
                row.pos.x += (width - row.size.x) / 2.;
            }
            ui.painter().galley(
                egui::pos2(rect.center().x - width / 2., y),
                description,
                p.muted,
            );
            y += description_height;
        }
        y += button_gap;
        let download = text_galley(
            ui,
            if self.ai_online {
                "Download Model"
            } else {
                "Download"
            },
            meta,
            meta_line,
            "medium",
            rect.width(),
            1,
            p.on_primary,
            false,
        );
        let retry = (!self.ai_online).then(|| {
            text_galley(
                ui,
                "Retry",
                meta,
                meta_line,
                "medium",
                rect.width(),
                1,
                p.primary,
                false,
            )
        });
        let download_width = download.size().x + 20. + if self.hosted { 2. } else { 0. };
        let retry_width = retry.as_ref().map(|t| t.size().x + 22.).unwrap_or(0.);
        let total_width = download_width
            + if retry.is_some() {
                8. + retry_width
            } else {
                0.
            };
        let button = egui::Rect::from_min_size(
            egui::pos2(rect.center().x - total_width / 2., y),
            egui::vec2(download_width, button_height),
        );
        ui.painter().rect(
            button,
            100,
            p.success,
            egui::Stroke::new(if self.hosted { 1_f32 } else { 0. }, p.outline),
            egui::StrokeKind::Inside,
        );
        ui.painter().galley(
            button.center() - download.size() / 2.,
            download,
            p.on_primary,
        );
        if ui
            .interact(button, ui.id().with("download-ai"), egui::Sense::click())
            .clicked()
        {
            if self.ai_online {
                self.start_model_pull();
            } else {
                open_external("https://ollama.com/download");
            }
        }
        if let Some(text) = retry {
            let button = egui::Rect::from_min_size(
                egui::pos2(button.right() + 8., y),
                egui::vec2(retry_width, button_height),
            );
            ui.painter().rect_stroke(
                button,
                100,
                egui::Stroke::new(1_f32, p.primary),
                egui::StrokeKind::Inside,
            );
            ui.painter()
                .galley(button.center() - text.size() / 2., text, p.primary);
            if ui
                .interact(button, ui.id().with("retry-ai"), egui::Sense::click())
                .clicked()
            {
                self.check_ai();
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
            self.ai_setup(ui);
            return;
        }
        let form_height = 53.;
        let message_height = (rect.height() - form_height).max(40.);
        egui::ScrollArea::vertical()
            .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
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
                    let color = if user { p.on_accent } else { p.muted };
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
                    } else if self.hosted {
                        ui.painter().rect_filled(
                            bubble,
                            egui::CornerRadius {
                                nw: 16,
                                ne: 16,
                                sw: 4,
                                se: 16,
                            },
                            Color32::from_rgb(223, 238, 229),
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
                        .hint_text(RichText::new("Ask me anything...").color(if self.hosted {
                            Color32::from_rgb(82, 107, 96)
                        } else {
                            Color32::from_gray(117)
                        }))
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
                            .tint(p.on_accent),
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
            let generation = self.ai_generation;
            self.rt.spawn(async move {
                let api = Ollama::default();
                let (chat, command) =
                    tokio::join!(api.chat(history, None), api.parse_command(&text));
                let reply = chat
                    .ok()
                    .and_then(|v| v["message"]["content"].as_str().map(str::to_owned));
                let _ = tx.send(Event::Chat(generation, reply, command.ok()));
            });
        }
    }
}
