import { createRequire } from 'node:module';
const require = createRequire('/home/user/AI-_Workforce/package.json');
const recharts = require('recharts');
export default recharts;
export const {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, RadialBarChart, RadialBar, ReferenceLine,
} = recharts;
