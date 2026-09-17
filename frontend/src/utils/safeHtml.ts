const allowedStyleProperties = new Set([
  'aspect-ratio',
  'background-color',
  'color',
  'display',
  'height',
  'margin',
  'max-height',
  'max-width',
  'min-height',
  'padding',
  'width',
]);

function sanitizeStyle(value: string) {
  return value
    .split(';')
    .map(declaration => declaration.trim())
    .filter(declaration => {
      const separator = declaration.indexOf(':');
      if (separator < 1) return false;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const cssValue = declaration.slice(separator + 1).trim();
      return allowedStyleProperties.has(property)
        && cssValue.length > 0
        && !/(url|expression|javascript|@import|-moz-binding)/i.test(cssValue);
    })
    .join('; ');
}

export function sanitizeEmbedHtml(html: string) {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode.querySelectorAll('script,style,link,object,embed,applet,base,form').forEach(node => node.remove());

  documentNode.querySelectorAll('*').forEach(node => {
    Array.from(node.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'nonce') {
        node.removeAttribute(attribute.name);
      } else if (name === 'style') {
        const cleanStyle = sanitizeStyle(value);
        if (cleanStyle) node.setAttribute('style', cleanStyle);
        else node.removeAttribute('style');
      } else if ((name === 'href' || name === 'src' || name === 'action') && !/^https:\/\//i.test(value)) {
        node.removeAttribute(attribute.name);
      }
    });

    if (node.tagName.toLowerCase() === 'iframe') {
      const src = node.getAttribute('src') ?? '';
      if (!/^https:\/\/open\.spotify\.com\/embed\//i.test(src)) {
        node.remove();
      } else {
        Array.from(node.attributes).forEach(attribute => {
          if (!['src', 'width', 'height', 'style', 'title', 'allow', 'allowfullscreen', 'loading', 'frameborder'].includes(attribute.name.toLowerCase())) {
            node.removeAttribute(attribute.name);
          }
        });
        node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
        node.setAttribute('referrerpolicy', 'no-referrer');
      }
    }
  });

  return documentNode.body.innerHTML;
}
