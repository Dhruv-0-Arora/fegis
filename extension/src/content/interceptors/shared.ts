export interface Replacement {
  original: string;
  fake: string;
}

export const state = {
  isAutoReplace: false,
  activeReplacements: [] as Replacement[],
  notifyReplaced: function(original: string, fake: string, type: 'outgoing') {
    window.postMessage({
      source: 'PII_SHIELD_INTERCEPTOR',
      type: 'REPLACEMENT_MADE',
      direction: type,
      original,
      fake,
    }, '*');
  }
};

export const applyOutgoingReplacements = (text: string) => {
  if (!text || typeof text !== 'string') return text;
  let newText = text;
  for (const { original, fake } of state.activeReplacements) {
    if (original && newText.includes(original)) {
      newText = newText.split(original).join(fake);
      state.notifyReplaced(original, fake, 'outgoing');
    }
  }
  return newText;
};

export const applyIncomingReplacements = (text: string) => {
  if (!text || typeof text !== 'string') return text;
  let newText = text;
  for (const { original, fake } of state.activeReplacements) {
    if (fake && newText.includes(fake)) {
      newText = newText.split(fake).join(original);
    }
  }
  return newText;
};
