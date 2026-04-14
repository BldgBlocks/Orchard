import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';

import { createApp } from 'vue';

import App from './App.vue';
import vuetify from './plugins/vuetify';
import './styles.css';

createApp(App).use(vuetify).mount('#app');
