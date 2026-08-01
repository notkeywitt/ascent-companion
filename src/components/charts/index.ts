/**
 * Chart templates — brand-styled, dependency-free bar and pie/donut charts.
 *
 *   import { BarChart, PieChart } from "@/components/charts";
 *
 * Both render inline SVG (no chart library), swap with the .dark theme via the
 * --series-* / --chart-* tokens in globals.css, and follow the data-viz method
 * (validated categorical palette, direct labels, legend, hover, table view).
 * See /charts for a live gallery of the variants.
 */

export { BarChart, type BarChartProps, type BarDatum } from "./BarChart";
export { PieChart, type PieChartProps, type PieDatum } from "./PieChart";
export {
  SERIES_VARS,
  seriesVar,
  ACCENT_VAR,
  makeFormat,
  currencyFull,
  type ValueFormat,
} from "./palette";
