import sanitizeHtml from 'sanitize-html';

/** HTML permitido em artigos (editor do CMS, IA e traduções). */
export const ALLOWED_IFRAME_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'player.twitch.tv',
  'clips.twitch.tv',
  'open.spotify.com',
  'w.soundcloud.com',
  'platform.twitter.com',
  'www.instagram.com',
];

export const sanitizePostHtml = (content: string) =>
  sanitizeHtml(content, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img',
      'h1',
      'h2',
      'h3',
      'figure',
      'figcaption',
      'iframe',
      'span',
    ]),
    // Única classe permitida: marcação de spoiler do editor.
    allowedClasses: { span: ['spoiler'] },
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'loading', 'width', 'height'],
      iframe: ['src', 'title', 'allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'], iframe: ['https'] },
    allowedIframeHostnames: ALLOWED_IFRAME_HOSTS,
    allowProtocolRelative: false,
    transformTags: {
      // Links externos nunca recebem acesso a window.opener.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer nofollow' } : {}) },
      }),
      iframe: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' },
      }),
    },
  });
