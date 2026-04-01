'use strict';

/**
 * Match a file path against a glob pattern.
 * Supports: * (single segment), ** (multi-segment), ? (single char)
 */
function globMatch(pattern, filePath) {
  const re = globToRegExp(pattern);
  return re.test(filePath);
}

/**
 * Convert a glob pattern to a RegExp.
 */
function globToRegExp(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** — match zero or more path segments
        i += 2;
        if (pattern[i] === '/') {
          i++; // consume trailing slash in **/
          re += '(?:.+/)?';
        } else {
          re += '.*';
        }
      } else {
        // * — match within a single path segment
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '.') {
      re += '\\.';
      i++;
    } else if (c === '(' || c === ')' || c === '{' || c === '}' || c === '+' || c === '^' || c === '$' || c === '|' || c === '\\') {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

/**
 * Check if a file path matches any pattern in the list.
 */
function matchesAny(patterns, filePath) {
  return patterns.some(p => globMatch(p, filePath));
}

module.exports = { globMatch, matchesAny };
