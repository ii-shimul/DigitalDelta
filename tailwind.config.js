module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        delta: {
          ink: '#12211f',
          forest: '#113d3a',
          mint: '#8fd0c6',
          sand: '#f3efe7',
          paper: '#fffaf2',
          sky: '#d8efe7',
          smoke: '#556560',
          success: '#1f8a70',
          danger: '#b45443',
          line: '#d9d1c3',
        },
      },
      boxShadow: {
        lift: '0 10px 30px rgba(17, 61, 58, 0.12)',
      },
    },
  },
  plugins: [],
};
