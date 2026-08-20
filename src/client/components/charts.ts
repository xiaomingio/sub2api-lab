/*
 * 文件说明: 注册管理台当前使用的 ECharts 图表模块，作为前端图表依赖的唯一入口。
 */

import * as echarts from "echarts/core";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { LineChart, PieChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([GridComponent, LegendComponent, TooltipComponent, LineChart, PieChart, CanvasRenderer]);

export default echarts;
