import type { AppSettings, PiTheme } from '../types';

type ThemeColors = Record<string, string>;

const DEFAULT_FONT_FAMILY = "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const DEFAULT_MONO_FONT_FAMILY = "'SF Mono', 'SFMono-Regular', ui-monospace, 'Cascadia Code', 'Cascadia Mono', Menlo, Monaco, Consolas, monospace";
export const DEFAULT_THEME_NAME = 'palette-nocturne';

export type ThemeSeries = 'dark' | 'light';

const DARK_THEME_NAMES = [
  'palette-nocturne',
  'dark',
  'graphite',
  'midnight-blue',
  'calm-slate',
  'forest-canopy',
  'ocean-depths',
  'violet-arc',
  'rose-quartz',
  'amber-workbench',
  'solarized-dark',
  'nord-frost',
  'dracula-night',
  'catppuccin-mocha',
  'crimson-lab',
  'cyberpunk',
  'cyberpunk-neon',
  'star-wars-galaxy',
  'claude-code',
  'codex',
  'trae',
  'terminal-green',
  'coffeehouse',
  'high-contrast-dark',
];

const LIGHT_THEME_NAMES = [
  'light',
  'iceberg',
  'matcha-latte',
  'lavender-mist',
  'sepia-paper',
  'solarized-light',
  'high-contrast-light',
];

const PRIORITY_THEME_NAMES = [...DARK_THEME_NAMES, ...LIGHT_THEME_NAMES];

const THEME_DISPLAY_NAMES: Record<string, string> = {
  dark: 'Dark',
  light: 'Light',
  'midnight-blue': 'Midnight Blue',
  'forest-canopy': 'Forest Canopy',
  'palette-nocturne': 'Palette Nocturne',
  'rose-quartz': 'Rose Quartz',
  'amber-workbench': 'Amber Workbench',
  'violet-arc': 'Violet Arc',
  'ocean-depths': 'Ocean Depths',
  graphite: 'Graphite',
  'solarized-dark': 'Solarized Dark',
  'solarized-light': 'Solarized Light',
  'nord-frost': 'Nord Frost',
  'dracula-night': 'Dracula Night',
  'catppuccin-mocha': 'Catppuccin Mocha',
  'matcha-latte': 'Matcha Latte',
  'crimson-lab': 'Crimson Lab',
  cyberpunk: 'Cyberpunk',
  'cyberpunk-neon': 'Cyberpunk Neon',
  'star-wars-galaxy': 'Star Wars Galaxy',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  trae: 'Trae',
  'calm-slate': 'Calm Slate',
  'sepia-paper': 'Sepia Paper',
  'high-contrast-dark': 'High Contrast Dark',
  'high-contrast-light': 'High Contrast Light',
  'lavender-mist': 'Lavender Mist',
  'terminal-green': 'Terminal Green',
  coffeehouse: 'Coffeehouse',
  iceberg: 'Iceberg',
};

export const BUILTIN_THEMES: PiTheme[] = [
  {
    name: 'dark',
    colors: {
      accent: '#5ac8fa',
      border: '#343b49',
      borderAccent: '#5ac8fa',
      borderMuted: '#242a34',
      success: '#63d48a',
      error: '#ff6b72',
      warning: '#f6c177',
      muted: '#a7b0c0',
      dim: '#6e7786',
      text: '#edf0f7',
      thinkingText: '#bac3d4',
      bg: '#111318',
      bgSecondary: '#171a21',
      bgTertiary: '#20242d',
      bgHover: '#2a303b',
      titlebarBg: '#0d0f13',
      titlebarText: '#edf0f7',
      titlebarBorder: '#242a34',
      titlebarHover: '#20242d',
      titlebarActive: '#263241',
      selectedBg: '#263241',
      userMessageBg: '#1f2a38',
      userMessageText: '#f4f7fb',
      customMessageBg: '#1c2430',
      customMessageText: '#f4f7fb',
      customMessageLabel: '#5ac8fa',
      toolPendingBg: '#1c2230',
      toolSuccessBg: '#14271d',
      toolErrorBg: '#2b171c',
      toolTitle: '#7dcfff',
      toolOutput: '#d8deea',
      mdHeading: '#f6c177',
      mdLink: '#7dcfff',
      mdLinkUrl: '#9da7b8',
      mdCode: '#9adbd5',
      mdCodeBlock: '#f1f4f8',
      mdCodeBlockBorder: '#3c4657',
      mdQuote: '#bac3d4',
      mdQuoteBorder: '#4d8fd6',
      mdHr: '#343b49',
      mdListBullet: '#9adbd5',
      toolDiffAdded: '#63d48a',
      toolDiffRemoved: '#ff6b72',
      toolDiffContext: '#9da7b8',
      syntaxComment: '#8792a2',
      syntaxKeyword: '#7dcfff',
      syntaxFunction: '#9adbd5',
      syntaxVariable: '#f6c177',
      syntaxString: '#63d48a',
      syntaxNumber: '#f5a6d6',
      syntaxType: '#b7b9ff',
      syntaxOperator: '#7dcfff',
      syntaxPunctuation: '#bac3d4',
      thinkingOff: '#6e7786',
      thinkingMinimal: '#5ac8fa',
      thinkingLow: '#7dcfff',
      thinkingMedium: '#9adbd5',
      thinkingHigh: '#f6c177',
      thinkingXhigh: '#ff6b72',
      bashMode: '#f6c177',
    },
  },
  {
    name: 'light',
    colors: {
      accent: '#006edb',
      border: '#d6dce6',
      borderAccent: '#006edb',
      borderMuted: '#e5e9f0',
      success: '#1f8f55',
      error: '#c8404a',
      warning: '#9b6400',
      muted: '#5f6673',
      dim: '#8d95a3',
      text: '#1d1d1f',
      thinkingText: '#4f5968',
      bg: '#f7f8fa',
      bgSecondary: '#ffffff',
      bgTertiary: '#eef1f5',
      bgHover: '#e5e9f0',
      titlebarBg: '#f3f5f8',
      titlebarText: '#1d1d1f',
      titlebarBorder: '#d6dce6',
      titlebarHover: '#e8edf4',
      titlebarActive: '#dcecff',
      selectedBg: '#dcecff',
      userMessageBg: '#edf5ff',
      userMessageText: '#1d1d1f',
      customMessageBg: '#f2f6fb',
      customMessageText: '#1d1d1f',
      customMessageLabel: '#006edb',
      toolPendingBg: '#f1f5fb',
      toolSuccessBg: '#edf9f1',
      toolErrorBg: '#fff0f2',
      toolTitle: '#006edb',
      toolOutput: '#2d3340',
      mdHeading: '#875a00',
      mdLink: '#006edb',
      mdLinkUrl: '#6f7784',
      mdCode: '#006d73',
      mdCodeBlock: '#1d1d1f',
      mdCodeBlockBorder: '#cbd3df',
      mdQuote: '#5f6673',
      mdQuoteBorder: '#5a9ee8',
      mdHr: '#d6dce6',
      mdListBullet: '#006d73',
      toolDiffAdded: '#1f8f55',
      toolDiffRemoved: '#c8404a',
      toolDiffContext: '#6f7784',
      syntaxComment: '#6f7784',
      syntaxKeyword: '#006edb',
      syntaxFunction: '#007d8a',
      syntaxVariable: '#875a00',
      syntaxString: '#1f8f55',
      syntaxNumber: '#a5367a',
      syntaxType: '#5a55b3',
      syntaxOperator: '#006edb',
      syntaxPunctuation: '#5f6673',
      thinkingOff: '#8d95a3',
      thinkingMinimal: '#006edb',
      thinkingLow: '#007d8a',
      thinkingMedium: '#006d73',
      thinkingHigh: '#9b6400',
      thinkingXhigh: '#c8404a',
      bashMode: '#875a00',
    },
  },
  themeVariant('midnight-blue', {
    accent: '#66d9ff',
    bg: '#07111f',
    bgSecondary: '#0b1728',
    bgTertiary: '#10243b',
    bgHover: '#17324f',
    border: '#24415f',
    borderMuted: '#17283a',
    selectedBg: '#14385a',
    text: '#e6f2ff',
    muted: '#8aa5bd',
    dim: '#567187',
    warning: '#ffd166',
    success: '#57d68d',
    error: '#ff6b7a',
    syntaxString: '#7bd88f',
    syntaxNumber: '#f8a5ff',
  }),
  themeVariant('forest-canopy', {
    accent: '#7ddc8b',
    bg: '#09140d',
    bgSecondary: '#101d14',
    bgTertiary: '#182a1d',
    bgHover: '#203b27',
    border: '#31533a',
    borderMuted: '#203725',
    selectedBg: '#22452d',
    text: '#edf7ee',
    muted: '#93ad98',
    dim: '#667b6a',
    warning: '#e6c75a',
    success: '#6ee78a',
    error: '#ff7a7a',
    mdHeading: '#d7e879',
  }),
  themeVariant('palette-nocturne', {
    accent: '#8fd56b',
    bg: '#0b1012',
    bgSecondary: '#11181b',
    bgTertiary: '#182226',
    bgHover: '#223036',
    border: '#32444b',
    borderMuted: '#223138',
    selectedBg: '#1e3a2c',
    text: '#edf5f2',
    thinkingText: '#b8c9c6',
    muted: '#9fb3b1',
    dim: '#708583',
    warning: '#e6c36a',
    success: '#8fd56b',
    error: '#dd6a86',
    titlebarBg: '#090d0f',
    titlebarText: '#edf5f2',
    titlebarBorder: '#223138',
    titlebarHover: '#172126',
    titlebarActive: '#1e3a2c',
    userMessageBg: '#15251f',
    userMessageText: '#edf5f2',
    customMessageBg: '#201a2a',
    customMessageText: '#edf5f2',
    customMessageLabel: '#8fd56b',
    toolPendingBg: '#151d21',
    toolSuccessBg: '#14291a',
    toolErrorBg: '#2b1720',
    toolTitle: '#8fd56b',
    toolOutput: '#d6e3e0',
    mdHeading: '#e6c36a',
    mdLink: '#73b7d8',
    mdLinkUrl: '#9fb3b1',
    mdCode: '#d79bdc',
    mdListBullet: '#8fd56b',
    syntaxKeyword: '#d79bdc',
    syntaxFunction: '#8fd56b',
    syntaxVariable: '#e6c36a',
    syntaxString: '#9edc82',
    syntaxNumber: '#e9a0b8',
    syntaxType: '#b9d68b',
    syntaxOperator: '#73b7d8',
    syntaxPunctuation: '#9fb3b1',
    thinkingMinimal: '#73b7d8',
    thinkingLow: '#8fd56b',
    thinkingMedium: '#e6c36a',
    thinkingHigh: '#d79bdc',
    thinkingXhigh: '#dd6a86',
    bashMode: '#e6c36a',
  }),
  themeVariant('rose-quartz', {
    accent: '#e68aa5',
    bg: '#1a1117',
    bgSecondary: '#241820',
    bgTertiary: '#30202b',
    bgHover: '#402a38',
    border: '#5a3b4d',
    borderMuted: '#3b2733',
    selectedBg: '#432b3a',
    text: '#fff1f6',
    muted: '#c6a0af',
    dim: '#8d6d7a',
    warning: '#e7bd74',
    success: '#78d0a2',
    error: '#ef6f82',
  }),
  themeVariant('amber-workbench', {
    accent: '#e2b65f',
    bg: '#17130d',
    bgSecondary: '#211b13',
    bgTertiary: '#302719',
    bgHover: '#3f3423',
    border: '#5b4930',
    borderMuted: '#3b3021',
    selectedBg: '#43351f',
    text: '#fff2df',
    muted: '#c2aa87',
    dim: '#8a765a',
    warning: '#eac56f',
    success: '#8bc989',
    error: '#ee7768',
    mdHeading: '#eac56f',
    mdLink: '#83b7d9',
  }),
  themeVariant('violet-arc', {
    accent: '#b794ff',
    bg: '#12101f',
    bgSecondary: '#19152a',
    bgTertiary: '#241d3b',
    bgHover: '#30274d',
    border: '#493c69',
    borderMuted: '#2d2542',
    selectedBg: '#382d5a',
    text: '#f3efff',
    muted: '#aba0c9',
    dim: '#776e94',
    warning: '#ffd166',
    success: '#75dda0',
    error: '#ff7190',
  }),
  themeVariant('ocean-depths', {
    accent: '#4dd8c8',
    bg: '#071817',
    bgSecondary: '#0c2221',
    bgTertiary: '#123230',
    bgHover: '#194642',
    border: '#2a615b',
    borderMuted: '#1a3d3a',
    selectedBg: '#1b504c',
    text: '#e9fffb',
    muted: '#8fb8b1',
    dim: '#5d807a',
    warning: '#f4c95d',
    success: '#69dfa2',
    error: '#ff6f7a',
  }),
  themeVariant('graphite', {
    accent: '#a7b3c4',
    bg: '#111214',
    bgSecondary: '#181a1d',
    bgTertiary: '#22252a',
    bgHover: '#2d3137',
    border: '#424852',
    borderMuted: '#2e333a',
    selectedBg: '#343a44',
    text: '#eef1f5',
    muted: '#a3abb8',
    dim: '#6c7480',
    warning: '#e0b85b',
    success: '#7ed18d',
    error: '#ee6b6e',
  }),
  themeVariant('solarized-dark', {
    accent: '#268bd2',
    bg: '#002b36',
    bgSecondary: '#073642',
    bgTertiary: '#0b3e4b',
    bgHover: '#164b58',
    border: '#315863',
    borderMuted: '#16424e',
    selectedBg: '#174b5a',
    text: '#eee8d5',
    muted: '#93a1a1',
    dim: '#657b83',
    warning: '#b58900',
    success: '#859900',
    error: '#ff6b66',
    mdHeading: '#d98a3f',
    syntaxString: '#2aa198',
    syntaxNumber: '#e57ab0',
  }),
  themeVariant('solarized-light', {
    accent: '#006fa6',
    bg: '#fdf6e3',
    bgSecondary: '#eee8d5',
    bgTertiary: '#e3dcc8',
    bgHover: '#d8d0ba',
    border: '#c9bfa5',
    borderMuted: '#ded6c1',
    selectedBg: '#dbeaf0',
    text: '#073642',
    muted: '#657b83',
    dim: '#93a1a1',
    warning: '#8d6500',
    success: '#557a00',
    error: '#dc322f',
    mdHeading: '#cb4b16',
    syntaxString: '#007d70',
    syntaxNumber: '#d33682',
  }),
  themeVariant('nord-frost', {
    accent: '#88c0d0',
    bg: '#2e3440',
    bgSecondary: '#343b49',
    bgTertiary: '#3b4252',
    bgHover: '#434c5e',
    border: '#4c566a',
    borderMuted: '#3b4252',
    selectedBg: '#40556b',
    text: '#eceff4',
    muted: '#d8dee9',
    dim: '#9aa6b8',
    warning: '#ebcb8b',
    success: '#a3be8c',
    error: '#e7828a',
    mdHeading: '#b48ead',
  }),
  themeVariant('dracula-night', {
    accent: '#bd93f9',
    bg: '#282a36',
    bgSecondary: '#303241',
    bgTertiary: '#393c4d',
    bgHover: '#44475a',
    border: '#55586d',
    borderMuted: '#3b3e50',
    selectedBg: '#3f4568',
    text: '#f8f8f2',
    muted: '#bfbfd5',
    dim: '#7e829a',
    warning: '#f1fa8c',
    success: '#50fa7b',
    error: '#ff5555',
    syntaxString: '#f1fa8c',
    syntaxNumber: '#ff79c6',
  }),
  themeVariant('catppuccin-mocha', {
    accent: '#89b4fa',
    bg: '#1e1e2e',
    bgSecondary: '#252537',
    bgTertiary: '#313244',
    bgHover: '#45475a',
    border: '#585b70',
    borderMuted: '#383a4c',
    selectedBg: '#394260',
    text: '#cdd6f4',
    muted: '#a6adc8',
    dim: '#6c7086',
    warning: '#f9e2af',
    success: '#a6e3a1',
    error: '#f38ba8',
    mdHeading: '#fab387',
  }),
  themeVariant('matcha-latte', {
    accent: '#2f7f5d',
    bg: '#f4f7ef',
    bgSecondary: '#ffffff',
    bgTertiary: '#e9efe1',
    bgHover: '#dde8d4',
    border: '#c7d4bd',
    borderMuted: '#dce5d4',
    selectedBg: '#d7ecd8',
    text: '#203126',
    muted: '#647867',
    dim: '#8c9d8c',
    warning: '#8f5f17',
    success: '#2f855a',
    error: '#c53030',
  }),
  themeVariant('crimson-lab', {
    accent: '#ff5c7a',
    bg: '#160b10',
    bgSecondary: '#211018',
    bgTertiary: '#321824',
    bgHover: '#442030',
    border: '#663247',
    borderMuted: '#3f2230',
    selectedBg: '#54283a',
    text: '#fff1f4',
    muted: '#c99aa5',
    dim: '#916a73',
    warning: '#ffc857',
    success: '#7ed891',
    error: '#ff4d4f',
  }),
  themeVariant('cyberpunk', {
    accent: '#41dce8',
    bg: '#100b1b',
    bgSecondary: '#181224',
    bgTertiary: '#231a33',
    bgHover: '#302444',
    border: '#4b3a62',
    borderMuted: '#2f2442',
    selectedBg: '#18344f',
    text: '#f9f7ff',
    muted: '#b7a8cf',
    dim: '#7b6a94',
    warning: '#e7d66a',
    success: '#62d88f',
    error: '#ed5f9c',
    mdHeading: '#e7d66a',
    syntaxString: '#62d88f',
    syntaxNumber: '#ed86bd',
  }),
  themeVariant('cyberpunk-neon', {
    accent: '#55e6dc',
    bg: '#080412',
    bgSecondary: '#10091d',
    bgTertiary: '#1a1230',
    bgHover: '#281b45',
    border: '#5f3aa0',
    borderMuted: '#2d1d52',
    selectedBg: '#12304d',
    text: '#f8f4ff',
    thinkingText: '#a4f4ef',
    muted: '#b9a6e8',
    dim: '#7960a9',
    warning: '#e1d657',
    success: '#67e39a',
    error: '#e85ca6',
    titlebarBg: '#05000d',
    titlebarHover: '#1b0f36',
    titlebarActive: '#271255',
    userMessageBg: '#1b1140',
    customMessageBg: '#23104a',
    toolPendingBg: '#100d2d',
    toolSuccessBg: '#082d24',
    toolErrorBg: '#341026',
    mdHeading: '#e1d657',
    mdLink: '#55e6dc',
    mdCode: '#e85ca6',
    syntaxKeyword: '#e85ca6',
    syntaxFunction: '#55e6dc',
    syntaxVariable: '#e1d657',
    syntaxString: '#67e39a',
    syntaxNumber: '#ed8fca',
    syntaxType: '#b9a6e8',
    thinkingHigh: '#e1d657',
    thinkingXhigh: '#e85ca6',
  }),
  themeVariant('star-wars-galaxy', {
    accent: '#5bbcff',
    bg: '#05070d',
    bgSecondary: '#0b0f1a',
    bgTertiary: '#121827',
    bgHover: '#1b2639',
    border: '#2f3e57',
    borderMuted: '#1a2434',
    selectedBg: '#102b46',
    text: '#f2f6ff',
    thinkingText: '#b9c8dd',
    muted: '#9aa9bd',
    dim: '#647286',
    warning: '#ffe45c',
    success: '#52d273',
    error: '#ff4f5e',
    titlebarBg: '#03050a',
    titlebarText: '#f7fbff',
    titlebarBorder: '#1d2b43',
    titlebarHover: '#101a2a',
    titlebarActive: '#18263d',
    userMessageBg: '#162238',
    userMessageText: '#f2f6ff',
    customMessageBg: '#111b2d',
    customMessageLabel: '#ffe45c',
    toolPendingBg: '#111827',
    toolSuccessBg: '#0d2517',
    toolErrorBg: '#2e1015',
    toolTitle: '#ffe45c',
    mdHeading: '#ffe45c',
    mdLink: '#5bbcff',
    mdCode: '#52d273',
    mdListBullet: '#ffe45c',
    syntaxKeyword: '#5bbcff',
    syntaxFunction: '#ffe45c',
    syntaxVariable: '#f2f6ff',
    syntaxString: '#52d273',
    syntaxNumber: '#ff6b70',
    syntaxType: '#8fb8ff',
    syntaxOperator: '#ff4f5e',
    thinkingMinimal: '#5bbcff',
    thinkingLow: '#52d273',
    thinkingMedium: '#ffe45c',
    thinkingHigh: '#ff4f5e',
    thinkingXhigh: '#ff2d35',
  }),
  themeVariant('claude-code', {
    accent: '#d87058',
    bg: '#080808',
    bgSecondary: '#101010',
    bgTertiary: '#181818',
    bgHover: '#202020',
    border: '#383838',
    borderMuted: '#202020',
    selectedBg: '#2a211f',
    text: '#f0f0e8',
    thinkingText: '#d8d0c8',
    muted: '#b8b0a8',
    dim: '#707070',
    warning: '#e8a05c',
    success: '#62b579',
    error: '#d87058',
    titlebarBg: '#080808',
    titlebarText: '#f0f0e8',
    titlebarBorder: '#202020',
    titlebarHover: '#181818',
    titlebarActive: '#2a211f',
    userMessageBg: '#181818',
    userMessageText: '#f0f0e8',
    customMessageBg: '#201816',
    customMessageText: '#f0f0e8',
    customMessageLabel: '#d87058',
    toolPendingBg: '#101010',
    toolSuccessBg: '#102018',
    toolErrorBg: '#281512',
    toolTitle: '#d87058',
    toolOutput: '#d8d0c8',
    mdHeading: '#d87058',
    mdLink: '#e08468',
    mdCode: '#e8a05c',
    syntaxKeyword: '#d87058',
    syntaxFunction: '#e8a05c',
    syntaxVariable: '#f0f0e8',
    syntaxString: '#7abf83',
    syntaxNumber: '#d890bc',
    syntaxType: '#c89a7a',
    syntaxOperator: '#d87058',
    thinkingMinimal: '#d87058',
    thinkingLow: '#e08468',
    thinkingMedium: '#e8a05c',
    thinkingHigh: '#d890bc',
    thinkingXhigh: '#d87058',
  }),
  themeVariant('codex', {
    accent: '#8d84d8',
    bg: '#101018',
    bgSecondary: '#181820',
    bgTertiary: '#202030',
    bgHover: '#282838',
    border: '#3d3a5f',
    borderMuted: '#282838',
    selectedBg: '#302858',
    text: '#d8d8e8',
    thinkingText: '#b8b4d8',
    muted: '#a8a4c8',
    dim: '#707078',
    warning: '#d8b868',
    success: '#10a37f',
    error: '#e36a8a',
    titlebarBg: '#080818',
    titlebarText: '#d8d8e8',
    titlebarBorder: '#202030',
    titlebarHover: '#202030',
    titlebarActive: '#302858',
    userMessageBg: '#202030',
    userMessageText: '#e8e8f0',
    customMessageBg: '#282040',
    customMessageText: '#e8e8f0',
    customMessageLabel: '#8d84d8',
    toolPendingBg: '#181820',
    toolSuccessBg: '#102820',
    toolErrorBg: '#301827',
    toolTitle: '#8d84d8',
    toolOutput: '#d8d8e8',
    mdHeading: '#f0f0ff',
    mdLink: '#8d84d8',
    mdCode: '#c6c0ff',
    syntaxKeyword: '#8d84d8',
    syntaxFunction: '#b0a8ff',
    syntaxVariable: '#d8d8e8',
    syntaxString: '#78d8b0',
    syntaxNumber: '#e08ac0',
    syntaxType: '#9090d8',
    syntaxOperator: '#8d84d8',
    thinkingMinimal: '#6860a8',
    thinkingLow: '#8d84d8',
    thinkingMedium: '#b0a8ff',
    thinkingHigh: '#d8b868',
    thinkingXhigh: '#e36a8a',
  }),
  themeVariant('trae', {
    accent: '#2ef28a',
    bg: '#050607',
    bgSecondary: '#08090b',
    bgTertiary: '#111316',
    bgHover: '#1a1d20',
    border: '#2b3035',
    borderMuted: '#20242a',
    selectedBg: '#082318',
    text: '#f7fbff',
    thinkingText: '#c8d4e3',
    muted: '#b7c5d8',
    dim: '#7d8ba0',
    warning: '#d7ff5f',
    success: '#2ef28a',
    error: '#ff5f6d',
    titlebarBg: '#050607',
    titlebarText: '#f7fbff',
    titlebarBorder: '#24282e',
    titlebarHover: '#171a1f',
    titlebarActive: '#082318',
    userMessageBg: '#0b1f16',
    userMessageText: '#f7fbff',
    customMessageBg: '#0f1714',
    customMessageText: '#f7fbff',
    customMessageLabel: '#2ef28a',
    toolPendingBg: '#101316',
    toolSuccessBg: '#092818',
    toolErrorBg: '#2a1016',
    toolTitle: '#2ef28a',
    toolOutput: '#c8d4e3',
    mdHeading: '#2ef28a',
    mdLink: '#b7c5d8',
    mdCode: '#2ef28a',
    mdListBullet: '#2ef28a',
    syntaxKeyword: '#2ef28a',
    syntaxFunction: '#f7fbff',
    syntaxVariable: '#c8d4e3',
    syntaxString: '#75ffb4',
    syntaxNumber: '#d7ff5f',
    syntaxType: '#9beec5',
    syntaxOperator: '#2ef28a',
    syntaxPunctuation: '#b7c5d8',
    thinkingMinimal: '#2ef28a',
    thinkingLow: '#75ffb4',
    thinkingMedium: '#b7c5d8',
    thinkingHigh: '#d7ff5f',
    thinkingXhigh: '#ff5f6d',
  }),
  themeVariant('calm-slate', {
    accent: '#7aa2f7',
    bg: '#151922',
    bgSecondary: '#1c2230',
    bgTertiary: '#242b3a',
    bgHover: '#30384a',
    border: '#445064',
    borderMuted: '#2d3545',
    selectedBg: '#2f3d5a',
    text: '#e8edf7',
    muted: '#a2adbf',
    dim: '#707b8d',
    warning: '#e0af68',
    success: '#9ece6a',
    error: '#f7768e',
  }),
  themeVariant('sepia-paper', {
    accent: '#2f76a8',
    bg: '#f6efe2',
    bgSecondary: '#fffaf0',
    bgTertiary: '#eadfce',
    bgHover: '#ded2bf',
    border: '#c7b69d',
    borderMuted: '#dfd2bf',
    selectedBg: '#d9e4eb',
    text: '#2e261c',
    muted: '#705f4b',
    dim: '#9a8870',
    warning: '#9b6800',
    success: '#4f7f46',
    error: '#b4443f',
    mdLink: '#2f76a8',
  }),
  themeVariant('high-contrast-dark', {
    accent: '#00e5ff',
    bg: '#000000',
    bgSecondary: '#080808',
    bgTertiary: '#141414',
    bgHover: '#222222',
    border: '#555555',
    borderMuted: '#303030',
    selectedBg: '#00394a',
    text: '#ffffff',
    muted: '#d0d0d0',
    dim: '#8a8a8a',
    warning: '#ffd400',
    success: '#00ff75',
    error: '#ff4a4a',
  }),
  themeVariant('high-contrast-light', {
    accent: '#0046ff',
    bg: '#ffffff',
    bgSecondary: '#f7f7f7',
    bgTertiary: '#ececec',
    bgHover: '#dddddd',
    border: '#707070',
    borderMuted: '#cfcfcf',
    selectedBg: '#dce5ff',
    text: '#000000',
    muted: '#333333',
    dim: '#777777',
    warning: '#8a5900',
    success: '#006b31',
    error: '#b00020',
  }),
  themeVariant('lavender-mist', {
    accent: '#6f4fc6',
    bg: '#f6f1ff',
    bgSecondary: '#ffffff',
    bgTertiary: '#ece4fb',
    bgHover: '#e2d7f8',
    border: '#cbbbe8',
    borderMuted: '#e3d8f3',
    selectedBg: '#ded0fa',
    text: '#251b3f',
    muted: '#6f5f87',
    dim: '#9a8bae',
    warning: '#a76f00',
    success: '#33835c',
    error: '#b33b5f',
  }),
  themeVariant('terminal-green', {
    accent: '#78d98f',
    bg: '#06100a',
    bgSecondary: '#0c1710',
    bgTertiary: '#122219',
    bgHover: '#1a3023',
    border: '#2f5a3c',
    borderMuted: '#1c3a27',
    selectedBg: '#204a2e',
    text: '#e6f8ea',
    muted: '#9ec7aa',
    dim: '#6d8f78',
    warning: '#d6c76b',
    success: '#78d98f',
    error: '#e66f7b',
    mdHeading: '#d6c76b',
  }),
  themeVariant('coffeehouse', {
    accent: '#74b7a0',
    bg: '#17120f',
    bgSecondary: '#211916',
    bgTertiary: '#2f241f',
    bgHover: '#3d3029',
    border: '#5b493f',
    borderMuted: '#3a302a',
    selectedBg: '#2f463d',
    text: '#fff0df',
    muted: '#c1a794',
    dim: '#877268',
    warning: '#e7b86b',
    success: '#87c98d',
    error: '#e17268',
    mdLink: '#8bc9d9',
  }),
  themeVariant('iceberg', {
    accent: '#2d7dd2',
    bg: '#edf6fb',
    bgSecondary: '#ffffff',
    bgTertiary: '#dfeef7',
    bgHover: '#d1e5f0',
    border: '#b7cfdd',
    borderMuted: '#d5e5ee',
    selectedBg: '#cfe6fa',
    text: '#102333',
    muted: '#536c7c',
    dim: '#8297a4',
    warning: '#9b6a00',
    success: '#287d55',
    error: '#bd3b4b',
  }),
];

function themeVariant(name: string, colors: ThemeColors): PiTheme {
  const accent = colors.accent ?? '#5ac8fa';
  const text = colors.text ?? '#edf0f7';
  const bg = colors.bg ?? '#111318';
  const light = relativeLuminance(bg) > 0.55;
  const bgSecondary = colors.bgSecondary ?? mixColor(bg, text, light ? 0.018 : 0.045);
  const bgTertiary = colors.bgTertiary ?? mixColor(bg, text, light ? 0.055 : 0.095);
  const bgHover = colors.bgHover ?? mixColor(bg, text, light ? 0.09 : 0.14);
  const border = colors.border ?? mixColor(bg, text, light ? 0.16 : 0.22);
  const borderMuted = colors.borderMuted ?? mixColor(bg, text, light ? 0.1 : 0.15);
  const selectedBg = colors.selectedBg ?? mixColor(bg, accent, light ? 0.12 : 0.2);
  const warning = colors.warning ?? (light ? '#9b6400' : '#f6c177');
  const success = colors.success ?? (light ? '#1f8f55' : '#63d48a');
  const error = colors.error ?? (light ? '#c8404a' : '#ff6b72');
  const muted = colors.muted ?? mixColor(text, bg, light ? 0.34 : 0.31);
  const dim = colors.dim ?? mixColor(text, bg, light ? 0.54 : 0.58);
  const readableAccent = ensureContrast(accent, bg, text, 4.5);
  const readableSuccess = ensureContrast(success, bg, text, 4.5);
  const readableWarning = ensureContrast(warning, bg, text, 4.5);
  const readableError = ensureContrast(error, bg, text, 4.5);
  const codeAccent = ensureContrast(mixColor(accent, success, 0.42), bg, text, 4.5);

  return {
    name,
    colors: {
      border,
      borderAccent: readableAccent,
      borderMuted,
      muted,
      dim,
      thinkingText: colors.thinkingText ?? muted,
      titlebarBg: colors.titlebarBg ?? bgSecondary,
      titlebarText: colors.titlebarText ?? text,
      titlebarBorder: colors.titlebarBorder ?? border,
      titlebarHover: colors.titlebarHover ?? bgHover,
      titlebarActive: colors.titlebarActive ?? selectedBg,
      selectedBg,
      userMessageBg: colors.userMessageBg ?? mixColor(bg, accent, light ? 0.08 : 0.16),
      userMessageText: colors.userMessageText ?? text,
      customMessageBg: colors.customMessageBg ?? mixColor(bg, accent, light ? 0.055 : 0.115),
      customMessageText: colors.customMessageText ?? text,
      customMessageLabel: colors.customMessageLabel ?? readableAccent,
      toolPendingBg: colors.toolPendingBg ?? bgTertiary,
      toolSuccessBg: colors.toolSuccessBg ?? mixColor(bg, success, light ? 0.08 : 0.12),
      toolErrorBg: colors.toolErrorBg ?? mixColor(bg, error, light ? 0.07 : 0.11),
      toolTitle: colors.toolTitle ?? readableAccent,
      toolOutput: colors.toolOutput ?? text,
      mdHeading: colors.mdHeading ?? readableWarning,
      mdLink: colors.mdLink ?? readableAccent,
      mdLinkUrl: colors.mdLinkUrl ?? muted,
      mdCode: colors.mdCode ?? codeAccent,
      mdCodeBlock: colors.mdCodeBlock ?? text,
      mdCodeBlockBorder: colors.mdCodeBlockBorder ?? mixColor(border, accent, 0.18),
      mdQuote: colors.mdQuote ?? muted,
      mdQuoteBorder: colors.mdQuoteBorder ?? mixColor(border, accent, 0.28),
      mdHr: colors.mdHr ?? border,
      mdListBullet: colors.mdListBullet ?? codeAccent,
      toolDiffAdded: colors.toolDiffAdded ?? readableSuccess,
      toolDiffRemoved: colors.toolDiffRemoved ?? readableError,
      toolDiffContext: colors.toolDiffContext ?? muted,
      syntaxComment: colors.syntaxComment ?? dim,
      syntaxKeyword: colors.syntaxKeyword ?? readableAccent,
      syntaxFunction: colors.syntaxFunction ?? codeAccent,
      syntaxVariable: colors.syntaxVariable ?? readableWarning,
      syntaxString: colors.syntaxString ?? readableSuccess,
      syntaxNumber: colors.syntaxNumber ?? ensureContrast(mixColor(warning, error, 0.28), bg, text, 4.5),
      syntaxType: colors.syntaxType ?? ensureContrast(mixColor(accent, text, light ? 0.22 : 0.18), bg, text, 4.5),
      syntaxOperator: colors.syntaxOperator ?? readableAccent,
      syntaxPunctuation: colors.syntaxPunctuation ?? muted,
      thinkingOff: colors.thinkingOff ?? dim,
      thinkingMinimal: colors.thinkingMinimal ?? readableAccent,
      thinkingLow: colors.thinkingLow ?? codeAccent,
      thinkingMedium: colors.thinkingMedium ?? readableSuccess,
      thinkingHigh: colors.thinkingHigh ?? readableWarning,
      thinkingXhigh: colors.thinkingXhigh ?? readableError,
      bashMode: colors.bashMode ?? readableWarning,
      ...colors,
    },
  };
}

function mixColor(a: string, b: string, amountOfB: number): string {
  const first = parseHexColor(a);
  const second = parseHexColor(b);
  if (!first || !second) return a;
  const weight = Math.max(0, Math.min(1, amountOfB));
  const channels = first.map((channel, index) => Math.round(channel * (1 - weight) + second[index]! * weight));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function ensureContrast(foreground: string, background: string, target: string, minimumRatio: number): string {
  if (contrastRatio(foreground, background) >= minimumRatio) return foreground;

  for (let step = 1; step <= 8; step++) {
    const candidate = mixColor(foreground, target, step * 0.1);
    if (contrastRatio(candidate, background) >= minimumRatio) return candidate;
  }

  return target;
}

const TOKEN_VAR_ALIASES: Record<string, string[]> = {
  userMessageBg: ['--pi-user-msg-bg'],
  userMessageText: ['--pi-user-msg-text'],
  customMessageBg: ['--pi-custom-msg-bg'],
  customMessageText: ['--pi-custom-msg-text'],
  customMessageLabel: ['--pi-custom-msg-label'],
  toolDiffAdded: ['--pi-diff-added'],
  toolDiffRemoved: ['--pi-diff-removed'],
  toolDiffContext: ['--pi-diff-context'],
};

export function applyRuntimeSettings(
  settings: Pick<AppSettings, 'theme' | 'language' | 'fontSize' | 'fontFamily' | 'monoFontFamily'>,
  themes: PiTheme[] = [],
): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const runtimeTheme = resolveRuntimeTheme(settings.theme, themes);

  root.lang = settings.language;
  root.dataset.language = settings.language;
  root.dataset.theme = runtimeTheme.name;
  root.style.fontSize = `${settings.fontSize}px`;
  root.style.setProperty('--font-sans', sanitizeFontStack(settings.fontFamily, DEFAULT_FONT_FAMILY));
  root.style.setProperty('--font-display', sanitizeFontStack(settings.fontFamily, DEFAULT_FONT_FAMILY));
  root.style.setProperty('--font-mono', sanitizeFontStack(settings.monoFontFamily, DEFAULT_MONO_FONT_FAMILY));
  root.style.setProperty('--font-code-editor', codeEditorFontStack(settings.monoFontFamily, settings.fontFamily));
  root.style.colorScheme = isLightTheme(runtimeTheme.colors, runtimeTheme.name) ? 'light' : 'dark';

  applyThemeColors(runtimeTheme.colors, runtimeTheme.vars);
}

function sanitizeFontStack(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || /[;{}]/.test(trimmed)) return fallback;
  return trimmed;
}

function codeEditorFontStack(monoValue: string | undefined, sansValue: string | undefined): string {
  const mono = sanitizeFontStack(monoValue, DEFAULT_MONO_FONT_FAMILY)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== 'monospace')
    .join(', ');
  const sans = sanitizeFontStack(sansValue, DEFAULT_FONT_FAMILY);

  return [
    mono || DEFAULT_MONO_FONT_FAMILY.replace(/,\s*monospace\s*$/i, ''),
    sans,
    "'PingFang SC'",
    "'Microsoft YaHei UI'",
    "'Microsoft YaHei'",
    "'Noto Sans CJK SC'",
    'monospace',
  ].join(', ');
}

export function resolveRuntimeTheme(themeName: string, themes: PiTheme[] = []): PiTheme {
  const suppliedThemes = themes.filter((theme) => theme.name === themeName && hasUsableThemeColors(theme));
  const serverTheme = suppliedThemes[suppliedThemes.length - 1];
  const fallbackTheme = BUILTIN_THEMES.find((theme) => theme.name === DEFAULT_THEME_NAME) ?? BUILTIN_THEMES[0]!;
  const builtinTheme = BUILTIN_THEMES.find((theme) => theme.name === themeName) ?? (serverTheme ? undefined : fallbackTheme);
  const baseTheme = baseThemeFor(serverTheme ?? builtinTheme, themeName);
  const resolvedName = serverTheme?.name ?? builtinTheme?.name ?? DEFAULT_THEME_NAME;

  return {
    name: resolvedName,
    vars: {
      ...(builtinTheme?.vars ?? {}),
      ...(serverTheme?.vars ?? {}),
    },
    colors: {
      ...baseTheme.colors,
      ...(builtinTheme?.colors ?? {}),
      ...(serverTheme?.colors ?? {}),
    },
    export: {
      ...(builtinTheme?.export ?? {}),
      ...(serverTheme?.export ?? {}),
    },
  };
}

export function listRuntimeThemes(themes: PiTheme[] = []): PiTheme[] {
  const byName = new Map<string, PiTheme>();

  for (const theme of BUILTIN_THEMES) {
    byName.set(theme.name, theme);
  }

  for (const theme of themes) {
    if (!hasUsableThemeColors(theme)) continue;
    byName.set(theme.name, {
      ...theme,
      colors: resolveRuntimeTheme(theme.name, themes).colors,
    });
  }

  return Array.from(byName.values()).sort((a, b) => themePriority(a.name) - themePriority(b.name));
}

function hasUsableThemeColors(theme: PiTheme): boolean {
  return Boolean(theme?.name && theme.colors && Object.keys(theme.colors).length > 0);
}

export function themeDisplayName(name: string): string {
  return THEME_DISPLAY_NAMES[name] ?? name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function themeSeries(theme: PiTheme): ThemeSeries {
  if (LIGHT_THEME_NAMES.includes(theme.name)) return 'light';
  if (DARK_THEME_NAMES.includes(theme.name)) return 'dark';
  return isLightTheme(theme.colors, theme.name) ? 'light' : 'dark';
}

export function groupRuntimeThemesBySeries(themes: PiTheme[]): Record<ThemeSeries, PiTheme[]> {
  return themes.reduce<Record<ThemeSeries, PiTheme[]>>(
    (groups, theme) => {
      groups[themeSeries(theme)].push(theme);
      return groups;
    },
    { dark: [], light: [] },
  );
}

function themePriority(name: string): number {
  const index = PRIORITY_THEME_NAMES.indexOf(name);
  return index === -1 ? PRIORITY_THEME_NAMES.length : index;
}

function applyThemeColors(colors: ThemeColors, vars?: Record<string, string>): void {
  const rootStyle = document.documentElement.style;

  for (const [token, value] of Object.entries(colors)) {
    for (const cssVar of cssVarsForToken(token)) {
      rootStyle.setProperty(cssVar, value);
    }
  }

  for (const [token, value] of Object.entries(vars ?? {})) {
    rootStyle.setProperty(token.startsWith('--') ? token : `--pi-${toKebab(token)}`, value);
  }
}

function cssVarsForToken(token: string): string[] {
  return [`--pi-${toKebab(token)}`, ...(TOKEN_VAR_ALIASES[token] ?? [])];
}

function baseThemeFor(theme: PiTheme | undefined, fallbackName: string): PiTheme {
  if (theme && isLightTheme(theme.colors, theme.name)) {
    return BUILTIN_THEMES[1]!;
  }

  if (!theme && fallbackName.toLowerCase().includes('light')) {
    return BUILTIN_THEMES[1]!;
  }

  return BUILTIN_THEMES[0]!;
}

function isLightTheme(colors: ThemeColors, name: string): boolean {
  const bg = colors.bg ?? colors.bgSecondary;
  if (!bg) return name.toLowerCase().includes('light');
  return relativeLuminance(bg) > 0.55;
}

function relativeLuminance(color: string): number {
  const rgb = parseHexColor(color);
  if (!rgb) return 0;

  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHexColor(color: string): [number, number, number] | null {
  const raw = color.trim().replace(/^#/, '');
  const hex = /^[0-9a-f]{3}$/i.test(raw)
    ? raw.split('').map((char) => `${char}${char}`).join('')
    : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function toKebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
