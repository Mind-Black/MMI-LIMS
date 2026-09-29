import React from 'react';
import {
    CalendarDays, Microscope, List, UsersRound, Moon, Sun, LogOut, Menu,
    Plus, RefreshCw, Copy, CircleCheck, TriangleAlert, CircleAlert,
    Link, X, LoaderCircle, ChevronLeft, ChevronRight, Mail, Camera,
    CircleX, Circle, Clock, FileSpreadsheet, Upload, Download, Server,
    Pencil, Trash2
} from 'lucide-react';

const icons = {
    'fa-calendar-alt': CalendarDays,
    'fa-microscope': Microscope,
    'fa-list-alt': List,
    'fa-users-cog': UsersRound,
    'fa-moon': Moon,
    'fa-sun': Sun,
    'fa-sign-out-alt': LogOut,
    'fa-bars': Menu,
    'fa-plus': Plus,
    'fa-sync-alt': RefreshCw,
    'fa-copy': Copy,
    'fa-check-circle': CircleCheck,
    'fa-exclamation-triangle': TriangleAlert,
    'fa-exclamation-circle': CircleAlert,
    'fa-link': Link,
    'fa-times': X,
    'fa-spinner': LoaderCircle,
    'fa-chevron-left': ChevronLeft,
    'fa-chevron-right': ChevronRight,
    'fa-envelope': Mail,
    'fa-camera': Camera,
    'fa-times-circle': CircleX,
    'fa-circle': Circle,
    'fa-clock': Clock,
    'fa-file-csv': FileSpreadsheet,
    'fa-upload': Upload,
    'fa-download': Download,
    'fa-server': Server,
    'fa-edit': Pencil,
    'fa-trash': Trash2
};

const Icon = ({ className = '', ...props }) => {
    const classes = className.split(/\s+/);
    const name = classes.find(value => icons[value]);
    const Component = icons[name] || Circle;
    const styling = classes.filter(value => value !== name && value !== 'fas' && value !== 'far' && value !== 'fa-spin').join(' ');
    return <Component aria-hidden="true" width="1em" height="1em" className={`${styling} ${classes.includes('fa-spin') ? 'animate-spin' : ''}`} {...props} />;
};

export default Icon;
