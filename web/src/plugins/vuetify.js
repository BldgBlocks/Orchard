import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';

import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

const orchardDay = {
  dark: false,
  colors: {
    background: '#ebe4d8',
    surface: '#f3ede3',
    'surface-bright': '#faf6ef',
    primary: '#4b7a31',
    secondary: '#8d5a2b',
    accent: '#c93d39',
    success: '#5f8f35',
    warning: '#d98c2f',
    error: '#b33632',
    info: '#5b7fb8',
  },
};

const orchardNight = {
  dark: true,
  colors: {
    background: '#16170f',
    surface: '#222717',
    'surface-bright': '#2d341f',
    primary: '#9cc75b',
    secondary: '#d9a15a',
    accent: '#ff6e59',
    success: '#8ecf55',
    warning: '#f2c15d',
    error: '#ff8b77',
    info: '#9bb7e8',
  },
};

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'orchardDay',
    themes: {
      orchardDay,
      orchardNight,
    },
  },
  defaults: {
    VBtn: {
      rounded: 'xl',
    },
    VCard: {
      rounded: 'xl',
      elevation: 0,
    },
    VChip: {
      rounded: 'xl',
    },
    VSelect: {
      variant: 'outlined',
      density: 'comfortable',
    },
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
    },
  },
});
