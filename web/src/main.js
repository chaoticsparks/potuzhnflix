// main.js — entry point of the phone remote
import { mount } from 'svelte';
import '@fontsource/russo-one/400.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/caveat/700.css';
import './app.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app') });
