/**
 * Build an element. Text always goes through textContent, so feed text can
 * never become markup.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style')
      for (const [name, entry] of Object.entries(value))
        node.style.setProperty(name, entry);
    else if (key.startsWith('on'))
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat())
    if (child !== null && child !== undefined && child !== false)
      node.append(child);
  return node;
}

/** Only plain web links leave the app. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function externalLink(url, text, className = '') {
  const href = safeUrl(url);
  if (!href) return el('span', { class: className, text });
  return el('a', {
    class: className,
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    text,
  });
}
