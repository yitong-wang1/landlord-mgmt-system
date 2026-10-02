/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1565c0',
          dark: '#0d47a1',
          light: '#5e92f3',
        },
      },
    },
  },
  corePlugins: {
    // 让 Tailwind 与 MUI 共存：保留 preflight 以便统一盒模型
    preflight: true,
  },
  plugins: [],
};
