export default {
  ignoreFiles: ['**/node_modules/**', '**/.next/**', '**/tokens.css', 'apps/admin/src/app/globals.css'],
  rules: {
    'color-named': 'never',
    'declaration-property-value-disallowed-list': {
      '/.*/': [
        '/#[0-9a-fA-F]{3,8}\\b/',
        '/\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\\(/',
        '/(?:^|[\\s,(])-?(?:[0-9]*\\.)?[0-9]+px\\b/',
        '/(?:^|[\\s,(])(?:white|black|red|green|blue|grey|gray|navy|purple|orange|yellow)(?:$|[\\s,)])/',
      ],
    },
  },
}
