import type { Config } from 'tailwindcss'

export default {
  // hover: utilities apply only on devices that can hover (no sticky "hover" after a tap on a phone)
  future: { hoverOnlyWhenSupported: true },
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lime_cream: {
          DEFAULT: '#d9ed92',
          100: '#36420b',
          200: '#6c8415',
          300: '#a2c520',
          400: '#c3e250',
          500: '#d9ed92',
          600: '#e1f1a7',
          700: '#e8f4bd',
          800: '#f0f8d3',
          900: '#f7fbe9',
        },
        light_green: {
          DEFAULT: '#b5e48c',
          100: '#233b0e',
          200: '#46771c',
          300: '#6ab22a',
          400: '#8ed650',
          500: '#b5e48c',
          600: '#c4e9a2',
          700: '#d2efba',
          800: '#e1f4d1',
          900: '#f0fae8',
        },
        soft_green: {
          DEFAULT: '#99d98c',
          100: '#183612',
          200: '#306b24',
          300: '#47a136',
          400: '#69c757',
          500: '#99d98c',
          600: '#ade0a3',
          700: '#c2e8ba',
          800: '#d6f0d1',
          900: '#ebf7e8',
        },
        emerald: {
          DEFAULT: '#76c893',
          100: '#122d1c',
          200: '#245a37',
          300: '#368853',
          400: '#48b56e',
          500: '#76c893',
          600: '#90d3a7',
          700: '#acdebd',
          800: '#c8e9d3',
          900: '#e3f4e9',
        },
        ocean_mist: {
          DEFAULT: '#52b69a',
          100: '#10251f',
          200: '#1f4b3e',
          300: '#2f705e',
          400: '#3f967d',
          500: '#52b69a',
          600: '#75c5ae',
          700: '#97d4c3',
          800: '#bae2d7',
          900: '#dcf1eb',
        },
        tropical_teal: {
          DEFAULT: '#34a0a4',
          100: '#0a2021',
          200: '#154041',
          300: '#1f5f62',
          400: '#297f82',
          500: '#34a0a4',
          600: '#4bc2c6',
          700: '#78d1d4',
          800: '#a5e1e3',
          900: '#d2f0f1',
        },
        bondi_blue: {
          DEFAULT: '#168aad',
          100: '#041b22',
          200: '#093745',
          300: '#0d5267',
          400: '#126d89',
          500: '#168aad',
          600: '#1fb4e2',
          700: '#57c7e9',
          800: '#8fdaf0',
          900: '#c7ecf8',
        },
        cerulean: {
          DEFAULT: '#1a759f',
          100: '#051720',
          200: '#0a2e3f',
          300: '#0f465f',
          400: '#155d7e',
          500: '#1a759f',
          600: '#239dd6',
          700: '#57b7e4',
          800: '#8fcfed',
          900: '#c7e7f6',
        },
        baltic_blue: {
          DEFAULT: '#1e6091',
          100: '#06131d',
          200: '#0c263a',
          300: '#123956',
          400: '#184b73',
          500: '#1e6091',
          600: '#2983c8',
          700: '#57a3dd',
          800: '#8fc2e8',
          900: '#c7e0f4',
        },
        yale_blue: {
          DEFAULT: '#184e77',
          100: '#051018',
          200: '#0a1f2f',
          300: '#0f2f47',
          400: '#133e5f',
          500: '#184e77',
          600: '#2576b3',
          700: '#489bda',
          800: '#85bce6',
          900: '#c2def3',
        },
        brand: {
          50:  '#f7fbe9', // lime_cream 900
          100: '#dcf1eb', // ocean_mist 900
          200: '#d9ed92', // lime_cream DEFAULT
          300: '#76c893', // emerald DEFAULT
          400: '#52b69a', // ocean_mist DEFAULT
          500: '#34a0a4', // tropical_teal DEFAULT
          600: '#168aad', // bondi_blue DEFAULT
          700: '#1a759f', // cerulean DEFAULT
          800: '#1e6091', // baltic_blue DEFAULT
          900: '#184e77', // yale_blue DEFAULT
          950: '#051018', // yale_blue 100
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
