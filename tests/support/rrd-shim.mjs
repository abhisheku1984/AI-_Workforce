import { createRequire } from 'node:module';
const require = createRequire('/home/user/AI-_Workforce/package.json');
const rrd = require('react-router-dom');
export default rrd;
export const {
  BrowserRouter, MemoryRouter, Routes, Route, Navigate, NavLink, Link, useLocation,
  useNavigate, useParams, useSearchParams, Outlet,
} = rrd;
