//! Statistics computation and caching for Signal normalization.
//!
//! Normalization operations require whole-track statistics (min, max, percentiles).
//! These are computed once before frame iteration and cached for efficient lookup.

use std::collections::HashMap;

use crate::signal::SignalId;

/// Statistics computed from a signal's values across the entire track.
#[derive(Clone, Debug, Default)]
pub struct SignalStatistics {
    /// Minimum value observed.
    pub min: f32,
    /// Maximum value observed.
    pub max: f32,
    /// 5th percentile value (for robust normalization).
    pub percentile_5: f32,
    /// 95th percentile value (for robust normalization).
    pub percentile_95: f32,
    /// Mean value.
    pub mean: f32,
    /// Number of samples used to compute these statistics.
    pub sample_count: usize,
}

impl SignalStatistics {
    /// Compute statistics from a slice of samples.
    pub fn from_samples(samples: &[f32]) -> Self {
        if samples.is_empty() {
            return Self::default();
        }

        // Filter out NaN and Inf values
        let valid_samples: Vec<f32> = samples
            .iter()
            .copied()
            .filter(|v| v.is_finite())
            .collect();

        if valid_samples.is_empty() {
            return Self::default();
        }

        let n = valid_samples.len();

        // Sort for percentile computation
        let mut sorted = valid_samples.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        // Compute percentile indices
        let p5_idx = ((n as f32 * 0.05) as usize).min(n.saturating_sub(1));
        let p95_idx = ((n as f32 * 0.95) as usize).min(n.saturating_sub(1));

        // Compute mean
        let sum: f32 = valid_samples.iter().sum();
        let mean = sum / n as f32;

        Self {
            min: sorted[0],
            max: sorted[n - 1],
            percentile_5: sorted[p5_idx],
            percentile_95: sorted[p95_idx],
            mean,
            sample_count: n,
        }
    }

    /// Normalize a value using global (min-max) normalization.
    /// Returns value in range [0, 1].
    pub fn normalize_global(&self, value: f32) -> f32 {
        let range = self.max - self.min;
        if range <= 0.0 {
            0.5 // No range, return midpoint
        } else {
            ((value - self.min) / range).clamp(0.0, 1.0)
        }
    }

    /// Normalize a value using robust (percentile) normalization.
    /// Returns value in range [0, 1], with outliers clamped.
    pub fn normalize_robust(&self, value: f32) -> f32 {
        let range = self.percentile_95 - self.percentile_5;
        if range <= 0.0 {
            0.5 // No range, return midpoint
        } else {
            ((value - self.percentile_5) / range).clamp(0.0, 1.0)
        }
    }
}

/// Cache for signal statistics, keyed by SignalId.
#[derive(Default)]
pub struct StatisticsCache {
    cache: HashMap<SignalId, SignalStatistics>,
}

impl StatisticsCache {
    /// Create a new empty cache.
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
        }
    }

    /// Get statistics for a signal, computing if not cached.
    pub fn get_or_compute<F>(&mut self, id: SignalId, compute: F) -> &SignalStatistics
    where
        F: FnOnce() -> SignalStatistics,
    {
        self.cache.entry(id).or_insert_with(compute)
    }

    /// Get cached statistics for a signal (if available).
    pub fn get(&self, id: SignalId) -> Option<&SignalStatistics> {
        self.cache.get(&id)
    }

    /// Insert statistics for a signal.
    pub fn insert(&mut self, id: SignalId, stats: SignalStatistics) {
        self.cache.insert(id, stats);
    }

    /// Check if statistics are cached for a signal.
    pub fn contains(&self, id: SignalId) -> bool {
        self.cache.contains_key(&id)
    }

    /// Clear all cached statistics.
    pub fn clear(&mut self) {
        self.cache.clear();
    }

    /// Get the number of cached entries.
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Check if the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_statistics_from_samples() {
        let samples = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let stats = SignalStatistics::from_samples(&samples);

        assert!((stats.min - 1.0).abs() < 0.001);
        assert!((stats.max - 10.0).abs() < 0.001);
        assert!((stats.mean - 5.5).abs() < 0.001);
        assert_eq!(stats.sample_count, 10);
    }

    #[test]
    fn test_statistics_empty() {
        let stats = SignalStatistics::from_samples(&[]);
        assert_eq!(stats.sample_count, 0);
        assert_eq!(stats.min, 0.0);
        assert_eq!(stats.max, 0.0);
    }

    #[test]
    fn test_statistics_single_value() {
        let stats = SignalStatistics::from_samples(&[5.0]);
        assert!((stats.min - 5.0).abs() < 0.001);
        assert!((stats.max - 5.0).abs() < 0.001);
        assert!((stats.mean - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_statistics_filters_nan_inf() {
        let samples = vec![1.0, f32::NAN, 2.0, f32::INFINITY, 3.0, f32::NEG_INFINITY];
        let stats = SignalStatistics::from_samples(&samples);

        assert_eq!(stats.sample_count, 3);
        assert!((stats.min - 1.0).abs() < 0.001);
        assert!((stats.max - 3.0).abs() < 0.001);
    }

    #[test]
    fn test_normalize_global() {
        let stats = SignalStatistics {
            min: 0.0,
            max: 10.0,
            percentile_5: 1.0,
            percentile_95: 9.0,
            mean: 5.0,
            sample_count: 10,
        };

        assert!((stats.normalize_global(0.0) - 0.0).abs() < 0.001);
        assert!((stats.normalize_global(5.0) - 0.5).abs() < 0.001);
        assert!((stats.normalize_global(10.0) - 1.0).abs() < 0.001);

        // Clamping
        assert!((stats.normalize_global(-5.0) - 0.0).abs() < 0.001);
        assert!((stats.normalize_global(15.0) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_normalize_robust() {
        let stats = SignalStatistics {
            min: 0.0,
            max: 100.0,
            percentile_5: 10.0,
            percentile_95: 90.0,
            mean: 50.0,
            sample_count: 100,
        };

        assert!((stats.normalize_robust(10.0) - 0.0).abs() < 0.001);
        assert!((stats.normalize_robust(50.0) - 0.5).abs() < 0.001);
        assert!((stats.normalize_robust(90.0) - 1.0).abs() < 0.001);

        // Values outside percentiles are clamped
        assert!((stats.normalize_robust(0.0) - 0.0).abs() < 0.001);
        assert!((stats.normalize_robust(100.0) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_statistics_cache() {
        let mut cache = StatisticsCache::new();
        let id = SignalId::new();

        assert!(!cache.contains(id));

        let stats = SignalStatistics::from_samples(&[1.0, 2.0, 3.0]);
        cache.insert(id, stats.clone());

        assert!(cache.contains(id));
        assert_eq!(cache.len(), 1);

        let cached = cache.get(id).unwrap();
        assert!((cached.mean - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_cache_get_or_compute() {
        let mut cache = StatisticsCache::new();
        let id = SignalId::new();

        let mut computed = false;
        let stats = cache.get_or_compute(id, || {
            computed = true;
            SignalStatistics::from_samples(&[5.0])
        });

        assert!(computed);
        assert!((stats.mean - 5.0).abs() < 0.001);

        // Second call should use cached value
        computed = false;
        let stats = cache.get_or_compute(id, || {
            computed = true;
            SignalStatistics::from_samples(&[10.0])
        });

        assert!(!computed);
        assert!((stats.mean - 5.0).abs() < 0.001); // Still the original value
    }
}
