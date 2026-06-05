/**
 * Vercel Speed Insights Integration
 * Automatically tracks web vitals and performance metrics
 */
import { injectSpeedInsights } from './speed-insights.mjs';

// Initialize Speed Insights
// This will only track in production (not in development mode)
injectSpeedInsights();
