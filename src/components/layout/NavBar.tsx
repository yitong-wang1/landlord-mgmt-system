/**
 * NavBar：底部导航（AppShell 已内联，此文件作为可复用的紧凑导航条，
 * 供「返回列表」等场景使用，例如详情页顶部的返回条）。
 */
import { useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ArrowBack from '@mui/icons-material/ArrowBack';

interface NavBarProps {
  title: string;
  /** 返回目标路由，默认 history.back() */
  backTo?: string;
}

export function NavBar({ title, backTo }: NavBarProps) {
  const navigate = useNavigate();
  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar variant="dense">
        <IconButton edge="start" onClick={() => (backTo ? navigate(backTo) : navigate(-1))}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6" sx={{ ml: 1, fontSize: 17 }}>
          {title}
        </Typography>
      </Toolbar>
    </AppBar>
  );
}

export default NavBar;