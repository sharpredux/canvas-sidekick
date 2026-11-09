/// Match the browser popup's left/below placement, flipping at monitor edges.
pub fn popup_position(anchor: [f32; 4], size: [f32; 2], work: [f32; 4]) -> [f32; 2] {
    let [left, top, right, bottom] = anchor;
    let [x, y, width, height] = work;
    let popup_x = if left + size[0] > x + width {
        right - size[0]
    } else {
        left
    };
    let popup_y = if bottom + size[1] > y + height {
        top - size[1]
    } else {
        bottom
    };
    [
        popup_x.clamp(x, (x + width - size[0]).max(x)),
        popup_y.clamp(y, (y + height - size[1]).max(y)),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn popup_flips_at_screen_edges_without_clipping_a_small_owner() {
        let size = [392., 282.];
        let work = [0., 0., 1920., 1064.];
        assert_eq!(
            popup_position([413., 265., 747., 300.], size, work),
            [413., 300.]
        );
        // Observed Chromium placement: x=-125 relative to a 280px owner at x=1616.
        assert_eq!(
            popup_position([1629., 202., 1883., 241.], size, work),
            [1491., 241.]
        );
        assert_eq!(
            popup_position([413., 922., 667., 961.], size, work),
            [413., 640.]
        );
        assert_eq!(
            popup_position(
                [-1800., 900., -1500., 940.],
                size,
                [-1920., 0., 1920., 1000.]
            ),
            [-1800., 618.]
        );
    }
}
