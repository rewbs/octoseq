pub struct Sparkline {
    pub capacity: usize,
    pub data: Vec<f32>,
    pub cursor: usize,
    pub current_min: f32,
    pub current_max: f32,
    pub last_min: f32,
    pub last_max: f32,
}

impl Sparkline {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            data: vec![0.0; capacity],
            cursor: 0,
            current_min: f32::INFINITY,
            current_max: f32::NEG_INFINITY,
            // Initialize with 0-1 range to avoid initial flickering before first loop
            last_min: 0.0,
            last_max: 1.0,
        }
    }

    pub fn push(&mut self, value: f32) {
        if self.cursor >= self.capacity {
            // End of sweep
            self.last_min = self.current_min;
            self.last_max = self.current_max;

            // Reset for new sweep
            self.current_min = f32::INFINITY;
            self.current_max = f32::NEG_INFINITY;
            self.cursor = 0;
        }

        // Update current stats
        if value < self.current_min { self.current_min = value; }
        if value > self.current_max { self.current_max = value; }

        self.data[self.cursor] = value;
        self.cursor += 1;

        // Clear a small gap ahead to visualize the "head"
        // But only if we are not at end
        let gap_size = 10;
        for i in 0..gap_size {
            let _idx = (self.cursor + i) % self.capacity;
            // Only clear ahead if we haven't just wrapped to 0 and cleared idx 0...
            // actually standard pulse meter just cuts off.
            // Setting to 0.0 might be confusing if 0 is a valid signal.
            // Let's rely on the cursor rendering in shader or just let the "overwrite" break the continuity visually.
            // A simple "gap" is setting values to NAN or a sentinel, but simple line strip might draw lines to 0.
            // For now, let's just overwrite. The "cursor" approach in rendering (drawing only valid range) is also possible,
            // but "Pulse meter style" usually implies a fixed screen buffer where we update X.
            // In a line strip, if we just update the Y value at index X, and draw the whole strip,
            // we get a continuous line that "changes" at the cursor.
            // To get the "gap", we can set the next few vertices to be degenerate or invisible.
            // Let's try just updating data for now.
        }
    }
}
