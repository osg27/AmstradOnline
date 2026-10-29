/* WebX68k host/core: GPL-2.0-only. See /x68000/webx68k/NOTICE.md and COPYING. */
(() => {
  // node_modules/fflate/esm/browser.js
  var u8 = Uint8Array;
  var u16 = Uint16Array;
  var i32 = Int32Array;
  var fleb = new u8([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0,
    /* unused */
    0,
    0,
    /* impossible */
    0
  ]);
  var fdeb = new u8([
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13,
    /* unused */
    0,
    0
  ]);
  var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var freb = function(eb, start2) {
    var b = new u16(31);
    for (var i = 0; i < 31; ++i) {
      b[i] = start2 += 1 << eb[i - 1];
    }
    var r = new i32(b[30]);
    for (var i = 1; i < 30; ++i) {
      for (var j = b[i]; j < b[i + 1]; ++j) {
        r[j] = j - b[i] << 5 | i;
      }
    }
    return { b, r };
  };
  var _a = freb(fleb, 2);
  var fl = _a.b;
  var revfl = _a.r;
  fl[28] = 258, revfl[258] = 28;
  var _b = freb(fdeb, 0);
  var fd = _b.b;
  var revfd = _b.r;
  var rev = new u16(32768);
  for (i = 0; i < 32768; ++i) {
    x = (i & 43690) >> 1 | (i & 21845) << 1;
    x = (x & 52428) >> 2 | (x & 13107) << 2;
    x = (x & 61680) >> 4 | (x & 3855) << 4;
    rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
  }
  var x;
  var i;
  var hMap = function(cd, mb, r) {
    var s = cd.length;
    var i = 0;
    var l = new u16(mb);
    for (; i < s; ++i) {
      if (cd[i])
        ++l[cd[i] - 1];
    }
    var le = new u16(mb);
    for (i = 1; i < mb; ++i) {
      le[i] = le[i - 1] + l[i - 1] << 1;
    }
    var co;
    if (r) {
      co = new u16(1 << mb);
      var rvb = 15 - mb;
      for (i = 0; i < s; ++i) {
        if (cd[i]) {
          var sv = i << 4 | cd[i];
          var r_1 = mb - cd[i];
          var v = le[cd[i] - 1]++ << r_1;
          for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
            co[rev[v] >> rvb] = sv;
          }
        }
      }
    } else {
      co = new u16(s);
      for (i = 0; i < s; ++i) {
        if (cd[i]) {
          co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
        }
      }
    }
    return co;
  };
  var flt = new u8(288);
  for (i = 0; i < 144; ++i)
    flt[i] = 8;
  var i;
  for (i = 144; i < 256; ++i)
    flt[i] = 9;
  var i;
  for (i = 256; i < 280; ++i)
    flt[i] = 7;
  var i;
  for (i = 280; i < 288; ++i)
    flt[i] = 8;
  var i;
  var fdt = new u8(32);
  for (i = 0; i < 32; ++i)
    fdt[i] = 5;
  var i;
  var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
  var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
  var max = function(a) {
    var m = a[0];
    for (var i = 1; i < a.length; ++i) {
      if (a[i] > m)
        m = a[i];
    }
    return m;
  };
  var bits = function(d, p, m) {
    var o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
  };
  var bits16 = function(d, p) {
    var o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
  };
  var shft = function(p) {
    return (p + 7) / 8 | 0;
  };
  var slc = function(v, s, e) {
    if (s == null || s < 0)
      s = 0;
    if (e == null || e > v.length)
      e = v.length;
    return new u8(v.subarray(s, e));
  };
  var ec = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    // determined by compression function
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data"
    // determined by unknown compression method
  ];
  var err = function(ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
      Error.captureStackTrace(e, err);
    if (!nt)
      throw e;
    return e;
  };
  var inflt = function(dat, st, buf, dict) {
    var sl = dat.length, dl = dict ? dict.length : 0;
    if (!sl || st.f && !st.l)
      return buf || new u8(0);
    var noBuf = !buf;
    var resize = noBuf || st.i != 2;
    var noSt = st.i;
    if (noBuf)
      buf = new u8(sl * 3);
    var cbuf = function(l2) {
      var bl = buf.length;
      if (l2 > bl) {
        var nbuf = new u8(Math.max(bl * 2, l2));
        nbuf.set(buf);
        buf = nbuf;
      }
    };
    var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
    var tbts = sl * 8;
    do {
      if (!lm) {
        final = bits(dat, pos, 1);
        var type = bits(dat, pos + 1, 3);
        pos += 3;
        if (!type) {
          var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
          if (t > sl) {
            if (noSt)
              err(0);
            break;
          }
          if (resize)
            cbuf(bt + l);
          buf.set(dat.subarray(s, t), bt);
          st.b = bt += l, st.p = pos = t * 8, st.f = final;
          continue;
        } else if (type == 1)
          lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
        else if (type == 2) {
          var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
          var tl = hLit + bits(dat, pos + 5, 31) + 1;
          pos += 14;
          var ldt = new u8(tl);
          var clt = new u8(19);
          for (var i = 0; i < hcLen; ++i) {
            clt[clim[i]] = bits(dat, pos + i * 3, 7);
          }
          pos += hcLen * 3;
          var clb = max(clt), clbmsk = (1 << clb) - 1;
          var clm = hMap(clt, clb, 1);
          for (var i = 0; i < tl; ) {
            var r = clm[bits(dat, pos, clbmsk)];
            pos += r & 15;
            var s = r >> 4;
            if (s < 16) {
              ldt[i++] = s;
            } else {
              var c = 0, n = 0;
              if (s == 16)
                n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
              else if (s == 17)
                n = 3 + bits(dat, pos, 7), pos += 3;
              else if (s == 18)
                n = 11 + bits(dat, pos, 127), pos += 7;
              while (n--)
                ldt[i++] = c;
            }
          }
          var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
          lbt = max(lt);
          dbt = max(dt);
          lm = hMap(lt, lbt, 1);
          dm = hMap(dt, dbt, 1);
        } else
          err(1);
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
      }
      if (resize)
        cbuf(bt + 131072);
      var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
      var lpos = pos;
      for (; ; lpos = pos) {
        var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
        pos += c & 15;
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (!c)
          err(2);
        if (sym < 256)
          buf[bt++] = sym;
        else if (sym == 256) {
          lpos = pos, lm = null;
          break;
        } else {
          var add = sym - 254;
          if (sym > 264) {
            var i = sym - 257, b = fleb[i];
            add = bits(dat, pos, (1 << b) - 1) + fl[i];
            pos += b;
          }
          var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
          if (!d)
            err(3);
          pos += d & 15;
          var dt = fd[dsym];
          if (dsym > 3) {
            var b = fdeb[dsym];
            dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
          }
          if (pos > tbts) {
            if (noSt)
              err(0);
            break;
          }
          if (resize)
            cbuf(bt + 131072);
          var end = bt + add;
          if (bt < dt) {
            var shift = dl - dt, dend = Math.min(dt, end);
            if (shift + bt < 0)
              err(3);
            for (; bt < dend; ++bt)
              buf[bt] = dict[shift + bt];
          }
          for (; bt < end; ++bt)
            buf[bt] = buf[bt - dt];
        }
      }
      st.l = lm, st.p = lpos, st.b = bt, st.f = final;
      if (lm)
        final = 1, st.m = lbt, st.d = dm, st.n = dbt;
    } while (!final);
    return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
  };
  var et = /* @__PURE__ */ new u8(0);
  var b2 = function(d, b) {
    return d[b] | d[b + 1] << 8;
  };
  var b4 = function(d, b) {
    return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
  };
  var b8 = function(d, b) {
    return b4(d, b) + b4(d, b + 4) * 4294967296;
  };
  function inflateSync(data, opts) {
    return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
  }
  var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
  var tds = 0;
  try {
    td.decode(et, { stream: true });
    tds = 1;
  } catch (e) {
  }
  var dutf8 = function(d) {
    for (var r = "", i = 0; ; ) {
      var c = d[i++];
      var eb = (c > 127) + (c > 223) + (c > 239);
      if (i + eb > d.length)
        return { s: r, r: slc(d, i - 1) };
      if (!eb)
        r += String.fromCharCode(c);
      else if (eb == 3) {
        c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
      } else if (eb & 1)
        r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
      else
        r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
    }
  };
  function strFromU8(dat, latin1) {
    if (latin1) {
      var r = "";
      for (var i = 0; i < dat.length; i += 16384)
        r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
      return r;
    } else if (td) {
      return td.decode(dat);
    } else {
      var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
      if (r.length)
        err(8);
      return s;
    }
  }
  var slzh = function(d, b) {
    return b + 30 + b2(d, b + 26) + b2(d, b + 28);
  };
  var zh = function(d, b, z) {
    var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
    var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
    return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
  };
  var z64hs = function(d, b, l, z, sc, su, off) {
    var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
    var nf = nsc + nsu + noff;
    if (z && nf) {
      for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
        if (b2(d, b) == 1) {
          return [
            nsc ? b8(d, b + 4 + 8 * nsu) : sc,
            nsu ? b8(d, b + 4) : su,
            noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
            1
          ];
        }
      }
      if (z < 2)
        err(13);
    }
    return [sc, su, off, 0];
  };
  function unzipSync(data, opts) {
    var files = {};
    var e = data.length - 22;
    for (; b4(data, e) != 101010256; --e) {
      if (!e || data.length - e > 65558)
        err(13);
    }
    ;
    var c = b2(data, e + 8);
    if (!c)
      return {};
    var o = b4(data, e + 16);
    var z = b4(data, e - 20) == 117853008;
    if (z) {
      var ze = b4(data, e - 12);
      z = b4(data, ze) == 101075792;
      if (z) {
        c = b4(data, ze + 32);
        o = b4(data, ze + 48);
      }
    }
    var fltr = opts && opts.filter;
    for (var i = 0; i < c; ++i) {
      var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
      o = no;
      if (!fltr || fltr({
        name: fn,
        size: sc,
        originalSize: su,
        compression: c_2
      })) {
        if (!c_2)
          files[fn] = slc(data, b, b + sc);
        else if (c_2 == 8)
          files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
        else
          err(14, "unknown compression type " + c_2);
      }
    }
    return files;
  }

  // src/features/x68000/vendor/webx68k/keyboard.ts
  var RETROK = {
    UNKNOWN: 0,
    BACKSPACE: 8,
    TAB: 9,
    CLEAR: 12,
    RETURN: 13,
    PAUSE: 19,
    ESCAPE: 27,
    SPACE: 32,
    EXCLAIM: 33,
    QUOTEDBL: 34,
    HASH: 35,
    DOLLAR: 36,
    AMPERSAND: 38,
    QUOTE: 39,
    LEFTPAREN: 40,
    RIGHTPAREN: 41,
    ASTERISK: 42,
    PLUS: 43,
    COMMA: 44,
    MINUS: 45,
    PERIOD: 46,
    SLASH: 47,
    0: 48,
    1: 49,
    2: 50,
    3: 51,
    4: 52,
    5: 53,
    6: 54,
    7: 55,
    8: 56,
    9: 57,
    COLON: 58,
    SEMICOLON: 59,
    LESS: 60,
    EQUALS: 61,
    GREATER: 62,
    QUESTION: 63,
    AT: 64,
    LEFTBRACKET: 91,
    BACKSLASH: 92,
    RIGHTBRACKET: 93,
    CARET: 94,
    UNDERSCORE: 95,
    BACKQUOTE: 96,
    a: 97,
    b: 98,
    c: 99,
    d: 100,
    e: 101,
    f: 102,
    g: 103,
    h: 104,
    i: 105,
    j: 106,
    k: 107,
    l: 108,
    m: 109,
    n: 110,
    o: 111,
    p: 112,
    q: 113,
    r: 114,
    s: 115,
    t: 116,
    u: 117,
    v: 118,
    w: 119,
    x: 120,
    y: 121,
    z: 122,
    DELETE: 127,
    KP0: 256,
    KP1: 257,
    KP2: 258,
    KP3: 259,
    KP4: 260,
    KP5: 261,
    KP6: 262,
    KP7: 263,
    KP8: 264,
    KP9: 265,
    KP_PERIOD: 266,
    KP_DIVIDE: 267,
    KP_MULTIPLY: 268,
    KP_MINUS: 269,
    KP_PLUS: 270,
    KP_ENTER: 271,
    KP_EQUALS: 272,
    UP: 273,
    DOWN: 274,
    RIGHT: 275,
    LEFT: 276,
    INSERT: 277,
    HOME: 278,
    END: 279,
    PAGEUP: 280,
    PAGEDOWN: 281,
    F1: 282,
    F2: 283,
    F3: 284,
    F4: 285,
    F5: 286,
    F6: 287,
    F7: 288,
    F8: 289,
    F9: 290,
    F10: 291,
    F11: 292,
    F12: 293,
    F13: 294,
    F14: 295,
    F15: 296,
    NUMLOCK: 300,
    CAPSLOCK: 301,
    SCROLLOCK: 302,
    RSHIFT: 303,
    LSHIFT: 304,
    RCTRL: 305,
    LCTRL: 306,
    RALT: 307,
    LALT: 308,
    RMETA: 309,
    LMETA: 310,
    LSUPER: 311,
    RSUPER: 312,
    MODE: 313,
    COMPOSE: 314,
    HELP: 315,
    PRINT: 316,
    SYSREQ: 317,
    BREAK: 318,
    MENU: 319,
    POWER: 320,
    EURO: 321,
    UNDO: 322,
    OEM_102: 323,
    BROWSER_BACK: 324,
    BROWSER_FORWARD: 325,
    BROWSER_REFRESH: 326,
    BROWSER_STOP: 327,
    BROWSER_SEARCH: 328,
    BROWSER_FAVORITES: 329,
    BROWSER_HOME: 330,
    VOLUME_MUTE: 331
  };
  var RETROK_TO_SCANCODE = {
    [RETROK.ESCAPE]: 1,
    [RETROK[1]]: 2,
    [RETROK[2]]: 3,
    [RETROK[3]]: 4,
    [RETROK[4]]: 5,
    [RETROK[5]]: 6,
    [RETROK[6]]: 7,
    [RETROK[7]]: 8,
    [RETROK[8]]: 9,
    [RETROK[9]]: 10,
    [RETROK[0]]: 11,
    [RETROK.MINUS]: 12,
    [RETROK.EQUALS]: 13,
    [RETROK.BACKSLASH]: 14,
    [RETROK.BACKSPACE]: 15,
    [RETROK.TAB]: 16,
    [RETROK.q]: 17,
    [RETROK.w]: 18,
    [RETROK.e]: 19,
    [RETROK.r]: 20,
    [RETROK.t]: 21,
    [RETROK.y]: 22,
    [RETROK.u]: 23,
    [RETROK.i]: 24,
    [RETROK.o]: 25,
    [RETROK.p]: 26,
    [RETROK.BACKQUOTE]: 27,
    [RETROK.LEFTBRACKET]: 28,
    [RETROK.RETURN]: 29,
    [RETROK.a]: 30,
    [RETROK.s]: 31,
    [RETROK.d]: 32,
    [RETROK.f]: 33,
    [RETROK.g]: 34,
    [RETROK.h]: 35,
    [RETROK.j]: 36,
    [RETROK.k]: 37,
    [RETROK.l]: 38,
    [RETROK.SEMICOLON]: 39,
    [RETROK.QUOTE]: 40,
    [RETROK.RIGHTBRACKET]: 41,
    [RETROK.z]: 42,
    [RETROK.x]: 43,
    [RETROK.c]: 44,
    [RETROK.v]: 45,
    [RETROK.b]: 46,
    [RETROK.n]: 47,
    [RETROK.m]: 48,
    [RETROK.COMMA]: 49,
    [RETROK.PERIOD]: 50,
    [RETROK.SLASH]: 51,
    [RETROK.SPACE]: 53,
    [RETROK.HOME]: 54,
    [RETROK.DELETE]: 55,
    [RETROK.PAGEDOWN]: 56,
    [RETROK.PAGEUP]: 57,
    [RETROK.END]: 58,
    [RETROK.LEFT]: 59,
    [RETROK.UP]: 60,
    [RETROK.RIGHT]: 61,
    [RETROK.DOWN]: 62,
    [RETROK.CLEAR]: 63,
    [RETROK.KP_DIVIDE]: 64,
    [RETROK.KP_MULTIPLY]: 65,
    [RETROK.KP_MINUS]: 66,
    [RETROK.KP7]: 67,
    [RETROK.KP8]: 68,
    [RETROK.KP9]: 69,
    [RETROK.KP_PLUS]: 70,
    [RETROK.KP4]: 71,
    [RETROK.KP5]: 72,
    [RETROK.KP6]: 73,
    [RETROK.KP_EQUALS]: 74,
    [RETROK.KP1]: 75,
    [RETROK.KP2]: 76,
    [RETROK.KP3]: 77,
    [RETROK.KP_ENTER]: 78,
    [RETROK.KP0]: 79,
    [RETROK.KP_PERIOD]: 81,
    [RETROK.PRINT]: 82,
    [RETROK.SCROLLOCK]: 83,
    [RETROK.F11]: 84,
    [RETROK.EURO]: 85,
    [RETROK.UNDO]: 86,
    [RETROK.OEM_102]: 87,
    [RETROK.BROWSER_BACK]: 88,
    [RETROK.BROWSER_FORWARD]: 89,
    [RETROK.BROWSER_REFRESH]: 90,
    [RETROK.BROWSER_STOP]: 91,
    [RETROK.BROWSER_SEARCH]: 92,
    [RETROK.CAPSLOCK]: 93,
    [RETROK.INSERT]: 94,
    [RETROK.BROWSER_FAVORITES]: 95,
    [RETROK.BROWSER_HOME]: 96,
    [RETROK.BREAK]: 97,
    [RETROK.PAUSE]: 97,
    [RETROK.VOLUME_MUTE]: 98,
    [RETROK.F1]: 99,
    [RETROK.F2]: 100,
    [RETROK.F3]: 101,
    [RETROK.F4]: 102,
    [RETROK.F5]: 103,
    [RETROK.F6]: 104,
    [RETROK.F7]: 105,
    [RETROK.F8]: 106,
    [RETROK.F9]: 107,
    [RETROK.F10]: 108,
    [RETROK.LSHIFT]: 112,
    [RETROK.RSHIFT]: 112,
    [RETROK.LCTRL]: 113,
    [RETROK.RCTRL]: 113,
    [RETROK.LSUPER]: 114,
    [RETROK.LALT]: 114,
    [RETROK.RSUPER]: 115,
    [RETROK.RALT]: 115
  };
  var CODE_TO_RETROK = {
    // 英字
    KeyA: RETROK.a,
    KeyB: RETROK.b,
    KeyC: RETROK.c,
    KeyD: RETROK.d,
    KeyE: RETROK.e,
    KeyF: RETROK.f,
    KeyG: RETROK.g,
    KeyH: RETROK.h,
    KeyI: RETROK.i,
    KeyJ: RETROK.j,
    KeyK: RETROK.k,
    KeyL: RETROK.l,
    KeyM: RETROK.m,
    KeyN: RETROK.n,
    KeyO: RETROK.o,
    KeyP: RETROK.p,
    KeyQ: RETROK.q,
    KeyR: RETROK.r,
    KeyS: RETROK.s,
    KeyT: RETROK.t,
    KeyU: RETROK.u,
    KeyV: RETROK.v,
    KeyW: RETROK.w,
    KeyX: RETROK.x,
    KeyY: RETROK.y,
    KeyZ: RETROK.z,
    // 数字
    Digit0: RETROK[0],
    Digit1: RETROK[1],
    Digit2: RETROK[2],
    Digit3: RETROK[3],
    Digit4: RETROK[4],
    Digit5: RETROK[5],
    Digit6: RETROK[6],
    Digit7: RETROK[7],
    Digit8: RETROK[8],
    Digit9: RETROK[9],
    // 記号
    Minus: RETROK.MINUS,
    Equal: RETROK.EQUALS,
    BracketLeft: RETROK.LEFTBRACKET,
    BracketRight: RETROK.RIGHTBRACKET,
    Backslash: RETROK.BACKSLASH,
    Semicolon: RETROK.SEMICOLON,
    Quote: RETROK.QUOTE,
    Backquote: RETROK.BACKQUOTE,
    Comma: RETROK.COMMA,
    Period: RETROK.PERIOD,
    Slash: RETROK.SLASH,
    IntlYen: RETROK.BACKSLASH,
    IntlRo: RETROK.UNDERSCORE,
    // 制御
    Enter: RETROK.RETURN,
    Space: RETROK.SPACE,
    Escape: RETROK.ESCAPE,
    Backspace: RETROK.BACKSPACE,
    Tab: RETROK.TAB,
    CapsLock: RETROK.CAPSLOCK,
    KanaMode: RETROK.BROWSER_REFRESH,
    ShiftLeft: RETROK.LSHIFT,
    ShiftRight: RETROK.RSHIFT,
    ControlLeft: RETROK.LCTRL,
    ControlRight: RETROK.RCTRL,
    AltLeft: RETROK.LALT,
    AltRight: RETROK.RALT,
    MetaLeft: RETROK.LMETA,
    MetaRight: RETROK.RMETA,
    ContextMenu: RETROK.MENU,
    Insert: RETROK.INSERT,
    Delete: RETROK.DELETE,
    Home: RETROK.HOME,
    End: RETROK.END,
    PageUp: RETROK.PAGEUP,
    PageDown: RETROK.PAGEDOWN,
    PrintScreen: RETROK.PRINT,
    ScrollLock: RETROK.SCROLLOCK,
    Pause: RETROK.PAUSE,
    NumLock: RETROK.NUMLOCK,
    // 矢印
    ArrowUp: RETROK.UP,
    ArrowDown: RETROK.DOWN,
    ArrowLeft: RETROK.LEFT,
    ArrowRight: RETROK.RIGHT,
    // ファンクションキー
    F1: RETROK.F1,
    F2: RETROK.F2,
    F3: RETROK.F3,
    F4: RETROK.F4,
    F5: RETROK.F5,
    F6: RETROK.F6,
    F7: RETROK.F7,
    F8: RETROK.F8,
    F9: RETROK.F9,
    F10: RETROK.F10,
    F11: RETROK.F11,
    F12: RETROK.F12,
    // テンキー
    Numpad0: RETROK.KP0,
    Numpad1: RETROK.KP1,
    Numpad2: RETROK.KP2,
    Numpad3: RETROK.KP3,
    Numpad4: RETROK.KP4,
    Numpad5: RETROK.KP5,
    Numpad6: RETROK.KP6,
    Numpad7: RETROK.KP7,
    Numpad8: RETROK.KP8,
    Numpad9: RETROK.KP9,
    NumpadDecimal: RETROK.KP_PERIOD,
    NumpadDivide: RETROK.KP_DIVIDE,
    NumpadMultiply: RETROK.KP_MULTIPLY,
    NumpadSubtract: RETROK.KP_MINUS,
    NumpadAdd: RETROK.KP_PLUS,
    NumpadEnter: RETROK.KP_ENTER,
    NumpadEqual: RETROK.KP_EQUALS
  };
  var PLAIN_KEYS = {
    " ": RETROK.SPACE,
    "\n": RETROK.RETURN,
    "\r": RETROK.RETURN,
    "	": RETROK.TAB,
    "-": RETROK.MINUS,
    "^": RETROK.EQUALS,
    "\\": RETROK.BACKSLASH,
    "@": RETROK.BACKQUOTE,
    "[": RETROK.LEFTBRACKET,
    "]": RETROK.RIGHTBRACKET,
    ";": RETROK.SEMICOLON,
    ":": RETROK.QUOTE,
    ",": RETROK.COMMA,
    ".": RETROK.PERIOD,
    "/": RETROK.SLASH
  };
  var SHIFTED_KEYS = {
    "!": RETROK[1],
    '"': RETROK[2],
    "#": RETROK[3],
    $: RETROK[4],
    "%": RETROK[5],
    "&": RETROK[6],
    "'": RETROK[7],
    "(": RETROK[8],
    ")": RETROK[9],
    "=": RETROK.MINUS,
    "~": RETROK.EQUALS,
    "|": RETROK.BACKSLASH,
    "`": RETROK.BACKQUOTE,
    "{": RETROK.LEFTBRACKET,
    "}": RETROK.RIGHTBRACKET,
    "+": RETROK.SEMICOLON,
    "*": RETROK.QUOTE,
    "<": RETROK.COMMA,
    ">": RETROK.PERIOD,
    "?": RETROK.SLASH
  };

  // src/features/x68000/vendor/webx68k/key-repeat.ts
  function keyRepeatDelayMsFromSramValue(n) {
    if (!Number.isInteger(n) || n < 0 || n > 15) return null;
    return 200 + 100 * n;
  }
  function keyRepeatIntervalMsFromSramValue(n) {
    if (!Number.isInteger(n) || n < 0 || n > 15) return null;
    return 30 + 5 * n * n;
  }
  var NON_REPEATABLE_KEYS = /* @__PURE__ */ new Set([
    RETROK.LSHIFT,
    RETROK.RSHIFT,
    RETROK.LCTRL,
    RETROK.RCTRL,
    RETROK.LALT,
    RETROK.RALT,
    RETROK.LMETA,
    RETROK.RMETA,
    RETROK.LSUPER,
    RETROK.RSUPER,
    RETROK.CAPSLOCK,
    RETROK.NUMLOCK,
    RETROK.SCROLLOCK,
    RETROK.BROWSER_REFRESH,
    // かな(状態トグルのラッチキー。連打するとロックが反転を繰り返す)
    RETROK.BROWSER_STOP
    // ローマ字(同上)
  ]);

  // src/features/x68000/vendor/webx68k/rgb565.ts
  function buildRgb565Lut(littleEndian) {
    const lut = new Uint32Array(65536);
    for (let px = 0; px < 65536; px++) {
      const r5 = px >> 11 & 31;
      const g6 = px >> 5 & 63;
      const b5 = px & 31;
      const r = r5 << 3 | r5 >> 2;
      const g = g6 << 2 | g6 >> 4;
      const b = b5 << 3 | b5 >> 2;
      lut[px] = littleEndian ? (255 << 24 | b << 16 | g << 8 | r) >>> 0 : (r << 24 | g << 16 | b << 8 | 255) >>> 0;
    }
    return lut;
  }

  // src/features/x68000/vendor/webx68k/text-screen.ts
  var TVRAM_PLANE_SIZE = 131072;
  var TVRAM_SIZE = TVRAM_PLANE_SIZE * 4;
  var TVRAM_WIDTH = 1024;
  var TVRAM_HEIGHT = 1024;
  var TVRAM_BYTES_PER_LINE = TVRAM_WIDTH / 8;
  var KANJI_16X16_OFFSET = 0;
  var KANJI_16X16_GLYPH_BYTES = 32;
  var KANJI_TEN_PER_KU = 94;
  var ANK_8X16_OFFSET = 239616;
  var ANK_8X16_GLYPH_BYTES = 16;
  var ANK_GLYPH_COUNT = 256;
  var MINIMUM_ANK_CGROM_SIZE = ANK_8X16_OFFSET + ANK_GLYPH_COUNT * ANK_8X16_GLYPH_BYTES;
  var shiftJisDecoder = new TextDecoder("shift_jis");
  var reverseTablesCache = /* @__PURE__ */ new WeakMap();
  function glyphKey(rows) {
    let key = "";
    for (const row of rows) key += row.toString(16).padStart(2, "0");
    return key;
  }
  function isSupportedAnk(code) {
    return code >= 33 && code <= 126 || code >= 161 && code <= 223;
  }
  function decodeAnk(code) {
    if (code <= 126) return String.fromCharCode(code);
    return shiftJisDecoder.decode(Uint8Array.of(code));
  }
  function shiftJisToKanji16x16Offset(shiftJis) {
    const lead = shiftJis >>> 8;
    const trail = shiftJis & 255;
    const validLead = lead >= 129 && lead <= 159 || lead >= 224 && lead <= 239;
    const validTrail = trail >= 64 && trail <= 126 || trail >= 128 && trail <= 252;
    if (!validLead || !validTrail) return void 0;
    let jisRow = ((lead <= 159 ? lead - 129 : lead - 193) << 1) + 33;
    let jisCell;
    if (trail >= 159) {
      jisRow++;
      jisCell = trail - 126;
    } else {
      jisCell = trail - (trail <= 126 ? 31 : 32);
    }
    const ku = jisRow - 32;
    const ten = jisCell - 32;
    if (ten < 1 || ten > KANJI_TEN_PER_KU) return void 0;
    const kuIndex = ku >= 1 && ku <= 8 ? ku - 1 : ku >= 16 && ku <= 84 ? 8 + ku - 16 : -1;
    if (kuIndex < 0) return void 0;
    return KANJI_16X16_OFFSET + (kuIndex * KANJI_TEN_PER_KU + ten - 1) * KANJI_16X16_GLYPH_BYTES;
  }
  function jisToShiftJis(ku, ten) {
    const jisRow = ku + 32;
    const jisCell = ten + 32;
    let lead = (jisRow - 33 >> 1) + 129;
    if (lead > 159) lead += 64;
    let trail;
    if ((jisRow & 1) !== 0) {
      trail = jisCell + 31;
      if (trail >= 127) trail++;
    } else {
      trail = jisCell + 126;
    }
    return lead << 8 | trail;
  }
  function createAnk8x16ReverseTable(cgrom) {
    if (cgrom.byteLength < MINIMUM_ANK_CGROM_SIZE) {
      throw new Error(`CGROM \u304C\u77ED\u3059\u304E\u307E\u3059: ${cgrom.byteLength} bytes (\u5FC5\u8981: ${MINIMUM_ANK_CGROM_SIZE})`);
    }
    const table = /* @__PURE__ */ new Map();
    for (let code = 0; code < ANK_GLYPH_COUNT; code++) {
      if (!isSupportedAnk(code)) continue;
      const start2 = ANK_8X16_OFFSET + code * ANK_8X16_GLYPH_BYTES;
      const glyph = cgrom.subarray(start2, start2 + ANK_8X16_GLYPH_BYTES);
      if (!glyph.some((value) => value !== 0)) continue;
      const key = glyphKey(glyph);
      if (!table.has(key)) table.set(key, decodeAnk(code));
    }
    return table;
  }
  function createKanji16x16ReverseTable(cgrom) {
    const table = /* @__PURE__ */ new Map();
    const kuList = [
      ...Array.from({ length: 8 }, (_, index) => index + 1),
      ...Array.from({ length: 69 }, (_, index) => index + 16)
    ];
    for (const ku of kuList) {
      for (let ten = 1; ten <= KANJI_TEN_PER_KU; ten++) {
        const shiftJis = jisToShiftJis(ku, ten);
        const start2 = shiftJisToKanji16x16Offset(shiftJis);
        if (start2 === void 0 || start2 + KANJI_16X16_GLYPH_BYTES > cgrom.byteLength) continue;
        const glyph = cgrom.subarray(start2, start2 + KANJI_16X16_GLYPH_BYTES);
        if (!glyph.some((value) => value !== 0)) continue;
        const character = shiftJisDecoder.decode(Uint8Array.of(shiftJis >>> 8, shiftJis & 255));
        if (character.includes("\uFFFD")) continue;
        const key = glyphKey(glyph);
        if (!table.has(key)) table.set(key, character);
      }
    }
    return table;
  }
  function getReverseTables(cgrom) {
    const cached = reverseTablesCache.get(cgrom);
    if (cached) return cached;
    const created = {
      ank: createAnk8x16ReverseTable(cgrom),
      kanji: createKanji16x16ReverseTable(cgrom)
    };
    reverseTablesCache.set(cgrom, created);
    return created;
  }
  function trimLineEnd(line) {
    return line.replace(/ +$/u, "");
  }
  function combineWideGlyph(left, right) {
    const combined = new Uint8Array(KANJI_16X16_GLYPH_BYTES);
    for (let row = 0; row < 16; row++) {
      combined[row * 2] = left[row];
      combined[row * 2 + 1] = right[row];
    }
    return combined;
  }
  function sampleCell(tvram, cellX, cellY, scrollX, scrollY) {
    const glyph = new Uint8Array(ANK_8X16_GLYPH_BYTES);
    const planeUsed = [false, false, false, false];
    for (let glyphY = 0; glyphY < ANK_8X16_GLYPH_BYTES; glyphY++) {
      const pixelY = scrollY + cellY * 16 + glyphY & TVRAM_HEIGHT - 1;
      for (let glyphX = 0; glyphX < 8; glyphX++) {
        const pixelX = scrollX + cellX * 8 + glyphX & TVRAM_WIDTH - 1;
        const logicalAddress = pixelY * TVRAM_BYTES_PER_LINE + (pixelX >> 3);
        const storageAddress = logicalAddress ^ 1;
        const mask = 128 >> (pixelX & 7);
        let set = false;
        for (let plane = 0; plane < 4; plane++) {
          if ((tvram[storageAddress + plane * TVRAM_PLANE_SIZE] & mask) !== 0) {
            planeUsed[plane] = true;
            set = true;
          }
        }
        if (set) glyph[glyphY] |= 128 >> glyphX;
      }
    }
    return { glyph, key: glyphKey(glyph), nonEmpty: glyph.some((value) => value !== 0), planeUsed };
  }
  function extractTextScreen(tvram, cgrom, options) {
    if (tvram.byteLength < TVRAM_SIZE) {
      throw new Error(`TVRAM \u304C\u77ED\u3059\u304E\u307E\u3059: ${tvram.byteLength} bytes (\u5FC5\u8981: ${TVRAM_SIZE})`);
    }
    const columns = Math.floor(options.widthPixels / 8);
    const rows = Math.floor(options.heightPixels / 16);
    const scrollX = (options.scrollX ?? 0) & TVRAM_WIDTH - 1;
    const scrollY = (options.scrollY ?? 0) & TVRAM_HEIGHT - 1;
    const { ank: ankReverse, kanji: kanjiReverse } = getReverseTables(cgrom);
    const lines = [];
    const nonEmptyPlaneCells = [0, 0, 0, 0];
    let nonEmptyCells = 0;
    let matchedCells = 0;
    let unknownCells = 0;
    for (let cellY = 0; cellY < rows; cellY++) {
      const cells = Array.from({ length: columns }, (_, cellX) => sampleCell(tvram, cellX, cellY, scrollX, scrollY));
      for (const cell of cells) {
        cell.ank = cell.nonEmpty ? ankReverse.get(cell.key) : void 0;
        if (!cell.nonEmpty) continue;
        nonEmptyCells++;
        for (let plane = 0; plane < 4; plane++) {
          if (cell.planeUsed[plane]) nonEmptyPlaneCells[plane]++;
        }
      }
      let line = "";
      for (let cellX = 0; cellX < columns; ) {
        const left = cells[cellX];
        const right = cells[cellX + 1];
        let kanji;
        if (right) {
          if (!(left.ank !== void 0 && right.ank !== void 0)) {
            kanji = kanjiReverse.get(glyphKey(combineWideGlyph(left.glyph, right.glyph)));
          }
        }
        if (kanji !== void 0) {
          line += kanji;
          matchedCells += Number(left.nonEmpty) + Number(right.nonEmpty);
          cellX += 2;
          continue;
        }
        if (!left.nonEmpty) {
          line += " ";
        } else if (left.ank === void 0) {
          line += "\uFFFD";
          unknownCells++;
        } else {
          line += left.ank;
          matchedCells++;
        }
        cellX++;
      }
      lines.push(trimLineEnd(line));
    }
    return {
      available: true,
      lines,
      diagnostics: {
        columns,
        rows,
        nonEmptyCells,
        matchedCells,
        unknownCells,
        coverage: nonEmptyCells === 0 ? 0 : matchedCells / nonEmptyCells,
        nonEmptyPlaneCells,
        kanjiFontAvailable: kanjiReverse.size > 0
      }
    };
  }
  function unavailableTextScreenDump(reason) {
    return {
      available: false,
      unavailableReason: reason,
      lines: [],
      diagnostics: {
        columns: 0,
        rows: 0,
        nonEmptyCells: 0,
        matchedCells: 0,
        unknownCells: 0,
        coverage: 0,
        nonEmptyPlaneCells: [0, 0, 0, 0],
        kanjiFontAvailable: false
      }
    };
  }
  function extractTextScreenFromCore(mod, cgrom, overrides = {}) {
    const required = [
      mod._webx68k_tvram_data,
      mod._webx68k_text_dot_x,
      mod._webx68k_text_dot_y,
      mod._webx68k_text_scroll_x,
      mod._webx68k_text_scroll_y
    ];
    if (required.some((fn) => typeof fn !== "function")) {
      throw new Error("TVRAM \u753B\u9762\u53D6\u5F97\u7528 export \u304C\u3042\u308A\u307E\u305B\u3093\u3002scripts/build-core.sh \u3067\u30B3\u30A2\u3092\u518D\u30D3\u30EB\u30C9\u3057\u3066\u304F\u3060\u3055\u3044");
    }
    const ptr = mod._webx68k_tvram_data();
    if (ptr <= 0 || ptr + TVRAM_SIZE > mod.HEAPU8.byteLength) {
      throw new Error(`TVRAM \u30DD\u30A4\u30F3\u30BF\u304C\u4E0D\u6B63\u3067\u3059: 0x${ptr.toString(16)}`);
    }
    const tvram = mod.HEAPU8.subarray(ptr, ptr + TVRAM_SIZE);
    return extractTextScreen(tvram, cgrom, {
      widthPixels: overrides.widthPixels ?? mod._webx68k_text_dot_x(),
      heightPixels: overrides.heightPixels ?? mod._webx68k_text_dot_y(),
      scrollX: overrides.scrollX ?? mod._webx68k_text_scroll_x(),
      scrollY: overrides.scrollY ?? mod._webx68k_text_scroll_y()
    });
  }

  // src/features/x68000/vendor/webx68k/keybuf-attribution.ts
  function initialTrackerState() {
    return { lastWritePointer: -1, writeFrameNo: null };
  }

  // src/features/x68000/vendor/webx68k/storage-probe.ts
  function fnv1a(bytes) {
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  var TAIL_LEN = 64;
  function tailBytes(bytes) {
    return bytes.length <= TAIL_LEN ? bytes : bytes.subarray(bytes.length - TAIL_LEN);
  }
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function verifyBytes(expected, actual) {
    if (actual === null) {
      return {
        ok: false,
        sizeMatch: false,
        tailMatch: false,
        checksumMatch: false,
        expectedByteLength: expected.byteLength,
        actualByteLength: null,
        expectedChecksum: fnv1a(expected),
        actualChecksum: null
      };
    }
    const sizeMatch = expected.byteLength === actual.byteLength;
    const tailMatch = sizeMatch && bytesEqual(tailBytes(expected), tailBytes(actual));
    const expectedChecksum = fnv1a(expected);
    const actualChecksum = fnv1a(actual);
    const checksumMatch = expectedChecksum === actualChecksum;
    return {
      ok: sizeMatch && tailMatch && checksumMatch,
      sizeMatch,
      tailMatch,
      checksumMatch,
      expectedByteLength: expected.byteLength,
      actualByteLength: actual.byteLength,
      expectedChecksum,
      actualChecksum
    };
  }
  var StorageProbe = class {
    enabled = false;
    /** putDisk() 内で次回1回だけ、tx.oncomplete前にtx.abort()する(陽性対照込みの故障注入用)。 */
    abortNextPut = false;
    diskSaves = [];
    ramExpansions = [];
    libraryLoads = [];
    /** 次回1回だけの起動時RAM展開の故障注入(測定専用。libretro-host.tsのprobedMemfsWriteが消費)。 */
    nextRamFault = null;
    reset() {
      this.diskSaves = [];
      this.ramExpansions = [];
      this.libraryLoads = [];
      this.abortNextPut = false;
      this.nextRamFault = null;
    }
  };
  var storageProbe = new StorageProbe();
  if (false) {
    window.__webx68kStorageProbe = storageProbe;
  }
  var FrameProbe = class {
    enabled = false;
    /** 60フレームごとに50msのbusy waitを注入する(測定系の検証専用。故障注入)。 */
    busyWaitFaultEnabled = false;
    /** runFrame()が呼ばれるたびに進める通しカウンタ。videoEventsとの対応付けに使う。 */
    frameCounter = 0;
    runEvents = [];
    videoEvents = [];
    /** 前面タブのrAF観測間隔用。メインの駆動ループ(rAF/setTimeoutの競争)とは別に、
     * 観測専用の独立したrequestAnimationFrameチェーンがperformance.now()を積む。 */
    rafSamples = [];
    longTasks = [];
    reset() {
      this.frameCounter = 0;
      this.runEvents = [];
      this.videoEvents = [];
      this.rafSamples = [];
      this.longTasks = [];
    }
  };
  var frameProbe = new FrameProbe();
  if (false) {
    window.__webx68kFrameProbe = frameProbe;
  }
  var KeybufAttributionProbe = class {
    enabled = false;
    /** このプローブが有効な間だけ進む、コアが完了したretro_run()の累積数。単一のクロック
     * (docs参照)。Worker経路のframeNoと同じ役割。frameProbe.frameCounterとは独立。 */
    frameNo = 0;
    tracker = initialTrackerState();
    /** 直近の applyKey/applyKeyMake 呼び出し(host.setKey/sendKeyMakeへ渡す直前)の時点で
     * このプローブが知っていたframeNo。「注入の遅れ」の起点。 */
    inputSendFrameNo = null;
    /** 2026-08-31再訂正(「帰属の定義の誤りと訂正」参照): 実際に入力が適用された瞬間の
     * frameNo。既定経路は送信と適用が同一呼び出しの中で起きるため、常に inputSendFrameNo と
     * 同値になる(Worker経路との式(trueInjectionFrames = writeFrameNo - applyFrameNo)を
     * 揃えるためだけに持つフィールドで、既定経路単独では意味のある差を生まない)。 */
    applyFrameNo = null;
    reset() {
      this.frameNo = 0;
      this.tracker = initialTrackerState();
      this.inputSendFrameNo = null;
      this.applyFrameNo = null;
    }
  };
  var keybufAttributionProbe = new KeybufAttributionProbe();
  if (false) {
    window.__webx68kKeybufAttributionProbe = keybufAttributionProbe;
  }

  // src/features/x68000/vendor/webx68k/libretro-host.ts
  function probedMemfsWrite(mod, kind, path, data) {
    if (true) {
      mod.FS.writeFile(path, data);
      return;
    }
    const fault = storageProbe.nextRamFault;
    storageProbe.nextRamFault = null;
    const writeData = fault === "truncate-tail" ? data.subarray(0, Math.max(0, data.byteLength - 1)) : fault === "corrupt-checksum" ? (() => {
      const copy = data.slice();
      const idx = Math.max(0, copy.length - 1 - 64);
      copy[idx] = copy[idx] + 1 & 255;
      return copy;
    })() : data;
    const startAtMs = performance.now();
    if (fault !== "skip-write") mod.FS.writeFile(path, writeData);
    const endAtMs = performance.now();
    let readBack = null;
    try {
      readBack = mod.FS.readFile(path);
    } catch {
      readBack = null;
    }
    storageProbe.ramExpansions.push({
      kind,
      fault,
      byteLength: data.byteLength,
      memfsWriteStartAtMs: startAtMs,
      memfsWriteEndAtMs: endAtMs,
      verify: verifyBytes(data, readBack)
    });
  }
  var LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  var rgb565Lut = null;
  var RETRO_ENVIRONMENT_GET_CAN_DUPE = 3;
  var RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY = 9;
  var RETRO_ENVIRONMENT_SET_PIXEL_FORMAT = 10;
  var RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS = 11;
  var RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK = 12;
  var RETRO_ENVIRONMENT_SET_DISK_CONTROL_INTERFACE = 13;
  var RETRO_ENVIRONMENT_GET_VARIABLE = 15;
  var RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE = 17;
  var LIVE_UPDATABLE_CORE_OPTIONS = /* @__PURE__ */ new Set(["px68k_cpuspeed"]);
  var RETRO_ENVIRONMENT_GET_LOG_INTERFACE = 27;
  var RETRO_ENVIRONMENT_SET_VARIABLES = 16;
  var RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME = 18;
  var RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY = 31;
  var RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO = 32;
  var RETRO_ENVIRONMENT_SET_CONTROLLER_INFO = 35;
  var RETRO_ENVIRONMENT_SET_GEOMETRY = 37;
  var RETRO_ENVIRONMENT_SET_CORE_OPTIONS = 53;
  var RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL = 54;
  var RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY = 55;
  var RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2 = 67;
  var RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL = 68;
  var RETRO_DEVICE_JOYPAD = 1;
  var RETRO_DEVICE_MOUSE = 2;
  var RETRO_DEVICE_KEYBOARD = 3;
  var RETRO_DEVICE_ID_MOUSE_X = 0;
  var RETRO_DEVICE_ID_MOUSE_Y = 1;
  var RETRO_DEVICE_ID_MOUSE_LEFT = 2;
  var RETRO_DEVICE_ID_MOUSE_RIGHT = 3;
  var RETRO_PIXEL_FORMAT_RGB565 = 2;
  var SRAM_SIGNATURE = [130, 119, 54, 56, 48, 48, 48, 87];
  function getPX68KFactory() {
    if (typeof window !== "undefined" && window.PX68K) {
      return window.PX68K;
    }
    return globalThis.PX68K;
  }
  var AUDIO_PROBE_NON_SILENT_THRESHOLD = 1e-4;
  function clampStep(value) {
    return Math.max(-128, Math.min(127, Math.trunc(value)));
  }
  function mallocString(mod, str) {
    const len = mod.lengthBytesUTF8(str) + 1;
    const ptr = mod._malloc(len);
    mod.stringToUTF8(str, ptr, len);
    return ptr;
  }
  function serializeCoreState(mod) {
    const size = mod._retro_serialize_size();
    if (size <= 0) return null;
    const ptr = mod._malloc(size);
    try {
      if (mod._retro_serialize(ptr, size) === 0) return null;
      return new Uint8Array(mod.HEAPU8.subarray(ptr, ptr + size));
    } finally {
      mod._free(ptr);
    }
  }
  function unserializeCoreState(mod, bytes) {
    if (bytes.length === 0) return false;
    const rollback = serializeCoreState(mod);
    if (!rollback) {
      console.warn(
        "[WebX68k] \u30ED\u30FC\u30EB\u30D0\u30C3\u30AF\u7528\u30B9\u30CA\u30C3\u30D7\u30B7\u30E7\u30C3\u30C8\u3092\u4F5C\u6210\u3067\u304D\u306A\u304B\u3063\u305F\u305F\u3081\u3001\u30B9\u30C6\u30FC\u30C8\u30ED\u30FC\u30C9\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002"
      );
      return false;
    }
    const ptr = mod._malloc(bytes.length);
    try {
      mod.HEAPU8.set(bytes, ptr);
      const restored = mod._retro_unserialize(ptr, bytes.length) !== 0;
      if (!restored) {
        const rollbackPtr = mod._malloc(rollback.length);
        try {
          mod.HEAPU8.set(rollback, rollbackPtr);
          if (mod._retro_unserialize(rollbackPtr, rollback.length) === 0) {
            console.warn("[WebX68k] \u30B9\u30C6\u30FC\u30C8\u30ED\u30FC\u30C9\u5931\u6557\u5F8C\u306E\u30ED\u30FC\u30EB\u30D0\u30C3\u30AF\u306B\u3082\u5931\u6557\u3057\u307E\u3057\u305F\u3002");
          }
        } finally {
          mod._free(rollbackPtr);
        }
      }
      return restored;
    } finally {
      mod._free(ptr);
    }
  }
  var LibretroHost = class {
    mod;
    canvas;
    ctx2d;
    audioPush;
    // 無制限時はコアの消費数を変えず、再生しないサンプルの変換だけを省く。
    audioMuted = false;
    systemDirPtr = 0;
    saveDirPtr = 0;
    coreOptions = /* @__PURE__ */ new Map();
    coreOptionPtrs = /* @__PURE__ */ new Map();
    /** LIVE_UPDATABLE_CORE_OPTIONS のキーが変わったら立てる。GET_VARIABLE_UPDATE で降ろす。 */
    coreOptionsDirty = false;
    keyState = /* @__PURE__ */ new Set();
    dirtyKeys = /* @__PURE__ */ new Set();
    keyStatePtr = 0;
    // dev限定・受動的な音声振幅プローブ(予備確認: docs/STORAGE-SCSI.md「音声遅延」参照)。
    // handleAudioBatch が既に全サンプルをFloat32へ変換するループを回しているため、その場で
    // 最大振幅と非無音サンプル数を積算するだけで済ませている。`import.meta.env.DEV` はViteの
    // 静的定数置換によりビルド時に確定するため、本番ビルドではこの分岐ごとデッドコード除去され
    // コストは残らない。一方dev環境では毎回のオーディオバッチ処理(概ね毎フレーム相当の頻度で
    // 呼ばれる)に比較1回ぶんのコストが常時乗る。呼ばれたときだけ読むKeyBufプローブと異なり、
    // 振幅は継続的な積算が要るため、この点はKeyBufプローブと性質が異なる(readMe参照)。
    audioProbeMaxAbs = 0;
    audioProbeSampleCount = 0;
    audioProbeNonSilentCount = 0;
    // 既定オフ。計測スクリプト(scripts/measure-audio.mjs)が明示的にtrueへ設定したときだけ
    // handleAudioBatch内の積算コストが乗る(作業0: プローブ有無での起動時間比較の結果、
    // docs/STORAGE-SCSI.md「基準値：音声遅延」参照)。dev環境でも既定では通常のKeyBuf/起動/
    // 3ドライブ計測に無関係なコストを乗せないため、常時onから既定offへ変更した。
    audioProbeEnabled = false;
    // マウスは X68000 実機同様「相対移動量」で渡す(SCC が -128..127 のデルタを送る方式)。
    // コアは retro_run() 中に X/Y を1回ずつ読むので、読まれた分だけ差し引いて次フレームへ繰り越す。
    // 端数を残すのは、感度を下げたときに微小移動が切り捨てで消えてしまうのを防ぐため。
    mouseDx = 0;
    mouseDy = 0;
    mouseButtons = { left: false, right: false };
    // RetroPad の押下状態をビットマスクで保持(bit = RETRO_DEVICE_ID_JOYPAD_*)。
    // ポート0/1の2系統ぶん。コアは retro_run() 中に inputStateCb を1IDずつ呼ぶので、
    // ここではポーリングされた瞬間の状態をそのまま返せればよい(マウスと違い積算しない)。
    joyState = [0, 0];
    imageData = null;
    imageData32 = null;
    lastWidth = 0;
    lastHeight = 0;
    callbackPtrs = [];
    // SRAM定期保存用。setInterval のIDと直近保存したバイト列(差分検出用)を持つ。
    sramAutosaveTimer = null;
    lastSavedSram = null;
    serialBridgePtr = 0;
    serialBridgeCapacity = 4096;
    _avInfo = null;
    // FS へ書いたものと逆引き用を必ず同じバイト列にするための唯一の CGROM 保持先。
    coreCgrom = null;
    /**
     * true の間、handleVideoRefresh() は変換も描画も行わず即 return する。
     *
     * 無制限速度モードでは1tickに何十フレームも retro_run() を回すため、毎フレーム
     * RGB565→RGBA変換+putImageDataをすると描画コストがボトルネックになり、フレーム数を
     * 稼げなくなる。中間フレームは変換ごと捨て、tick末尾の1フレームだけ画面に出す。
     */
    videoSkip = false;
    videoHidden = false;
    videoPending = true;
    lastVideoPointer = 0;
    videoCompositionDeferred = false;
    hiddenFrame = null;
    /** 非表示は間引きより優先する。復帰時は dupe だけでも最後の生画像を提示する。 */
    setVideoHidden(hidden) {
      if (this.videoHidden === hidden) return false;
      this.videoHidden = hidden;
      if (!hidden && this.hiddenFrame && !this.videoCompositionDeferred) {
        const frame = this.hiddenFrame;
        this.hiddenFrame = null;
        this.convertVideoFrame(frame.data, frame.width, frame.height, frame.pitch);
        this.videoPending = false;
        return true;
      }
      return false;
    }
    get hiddenVideoSize() {
      return this.hiddenFrame;
    }
    /** Worker 用の変換先。未設定なら従来どおり canvas に描画する。 */
    acquireVideoBuffer;
    /**
     * X68000 は画面モード変更で実行中に canvas.width/height(実解像度)が変わる。
     * ウィンドウ表示の等倍/整数倍リスケール(main.ts側)は canvas の実解像度を基準に
     * 計算しているため、解像度が変わった瞬間に再計算してもらう必要がある。
     * 毎フレーム呼ぶと無駄なので、handleVideoRefresh() 内で解像度が実際に変わった
     * ときだけ呼ぶ。呼び出し元(main.ts)が未配線でも動くよう任意プロパティにしている。
     */
    onResolutionChanged;
    /**
     * putImageData() でcanvas(#screen)へ新しいフレームを描いた直後に毎回呼ばれる。
     * main.ts側はこれを使って#screen-sharp(シャープ・バイリニア表示用の重ねcanvas)を
     * 描き直す(SharpView.present()参照)。呼び出し元(main.ts)が未配線でも動くよう
     * 任意プロパティにしている。
     */
    onFramePresented;
    /**
     * retro_run() 冒頭、コアが Joystick_Update() 等で入力を読み出す前に呼ばれる input_poll コールバックのフック。
     * 結合テストで「このフレームでポーリングされたか」を検出する目的で任意プロパティにしている。
     */
    onPoll;
    constructor(canvas2, audioPush) {
      this.canvas = canvas2;
      const ctx = canvas2.getContext("2d");
      if (!ctx) throw new Error("2D \u30B3\u30F3\u30C6\u30AD\u30B9\u30C8\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
      this.ctx2d = ctx;
      this.audioPush = audioPush;
    }
    get avInfo() {
      return this._avInfo;
    }
    /** 現在の TVRAM 表示を ANK・16x16漢字文字列として読む。取得不能時も例外ではなく診断結果を返す。 */
    readTextScreen() {
      if (!this.coreCgrom) return unavailableTextScreenDump("CGROM \u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093");
      if (!this.mod) return unavailableTextScreenDump("\u30B3\u30A2\u304C\u521D\u671F\u5316\u3055\u308C\u3066\u3044\u307E\u305B\u3093");
      if (this.coreCgrom.byteLength < MINIMUM_ANK_CGROM_SIZE) {
        return unavailableTextScreenDump(
          `CGROM \u304C\u77ED\u3059\u304E\u307E\u3059: ${this.coreCgrom.byteLength} bytes (\u5FC5\u8981: ${MINIMUM_ANK_CGROM_SIZE})`
        );
      }
      try {
        return extractTextScreenFromCore(this.mod, this.coreCgrom);
      } catch (err2) {
        return unavailableTextScreenDump(err2 instanceof Error ? err2.message : String(err2));
      }
    }
    setKey(retrok, down) {
      if (this.keyState.has(retrok) === down) return;
      if (down) this.keyState.add(retrok);
      else this.keyState.delete(retrok);
      if (Number.isInteger(retrok) && retrok >= 0 && retrok < 512) this.dirtyKeys.add(retrok);
    }
    /** 押下状態を変えず、RETROKに対応するmakeだけをコアへ追加する。 */
    sendKeyMake(retrok) {
      const sendMake = this.mod?._webx68k_send_key_make;
      const scancode = RETROK_TO_SCANCODE[retrok];
      if (!sendMake || scancode === void 0) return;
      sendMake(scancode);
    }
    /** マウスの相対移動量を積む(ゲスト1ドット単位。呼び出し側で感度・表示倍率を換算済みの値を渡す) */
    addMouseDelta(dx, dy) {
      this.mouseDx += dx;
      this.mouseDy += dy;
    }
    setMouseButton(button, down) {
      this.mouseButtons[button] = down;
    }
    /** ジョイパッドの押下状態を RetroPad ID ビットマスクで設定する(port: 0 or 1)。 */
    setJoyState(port, bits2) {
      this.joyState[port] = bits2;
    }
    /**
     * まだコアへ渡しきれていない移動量が残っているか。
     * 1回のポーリングで送れるのは ±128 までなので、大きな移動(追従モードの基準合わせ等)は
     * 数フレームかけて消化される。その完了待ちに使う。
     */
    hasPendingMouseDelta() {
      return Math.abs(this.mouseDx) >= 1 || Math.abs(this.mouseDy) >= 1;
    }
    /**
     * ゲストのマウスカーソル状態を IOCS ワークエリアから読む。
     * ホスト側で位置を推定しなくて済むので、追従モードを閉ループにできる。
     *   $ACE/$AD0 = カーソル座標, $A9A..$AA0 = 可動範囲, $AA2 = 表示スイッチ
     * 座標は符号付きワードとして解釈する。
     */
    /** ゲストメモリを1バイト読む(MCP ブリッジの read_memory 用) */
    peekByte(addr) {
      return this.mod._webx68k_peek8(addr);
    }
    /** ゲストメモリを1ワード(ビッグエンディアン)読む(デバッグ・IOCSワーク参照用) */
    peekWord(addr) {
      return this.mod._webx68k_peek16(addr);
    }
    /**
     * SRAM($ED0000-$ED3FFF)を1バイト読む(調査用)。offsetは$ED0000からの相対。
     * 罠(docs/STORAGE-SCSI.md参照): peekByte/peekWordはMEM[]をフラットに読むだけで
     * SRAM領域(SRAM_Read/SRAM_Write経由の別配列)を経由しないため、SRAM領域では
     * 一律ダミー値が返ってしまう。SRAM_Read()に届く_webx68k_sram_read()を必ず使うこと。
     * 古いコア(再ビルド前のwasm)には_webx68k_sram_readが無いため、そのときはnull。
     */
    peekSramByte(offset) {
      const sramRead = this.mod._webx68k_sram_read;
      if (!sramRead) return null;
      return sramRead(offset);
    }
    /**
     * SCSI起動 段階4(UI)用: SRAMへ1バイト書く(利用者が設定ダイアログで起動デバイスを
     * 変更したときに使う)。_webx68k_sram_write が無い古いコア(再ビルド前)では何もせず
     * false を返す(呼び出し側はUIで「反映できませんでした」を出す)。
     */
    writeSramByte(offset, value) {
      const sramWrite = this.mod._webx68k_sram_write;
      if (!sramWrite) return false;
      sramWrite(offset, value & 255);
      return true;
    }
    /**
     * SRAM先頭8バイトが機種シグネチャ「Ｘ68000W」と一致するか(readSram()/readKeyRepeatConfig()
     * と同じ健全性チェックを、起動デバイス読み取り専用に切り出したもの)。
     * _webx68k_sram_read が無い古いコアでは false。
     */
    hasValidSramSignature() {
      const sramRead = this.mod._webx68k_sram_read;
      if (!sramRead) return false;
      for (let i = 0; i < SRAM_SIGNATURE.length; i++) {
        if (sramRead(i) !== SRAM_SIGNATURE[i]) return false;
      }
      return true;
    }
    /**
     * HostFS (feature/hostfs) 用: ゲストRAMをブロックで読む。
     * _webx68k_mem_read が無い古いwasm(再ビルド前)では全域0バイトの配列を返す
     * (呼び出し側でその旨を判定できるようにするのが理想だが、この経路は
     * 新規機能でありビルド更新済み前提のため、まずは安全側の空値で妥協する)。
     */
    readGuestMemory(addr, len) {
      if (!this.mod._webx68k_mem_read || len <= 0) return new Uint8Array(Math.max(0, len));
      const ptr = this.mod._malloc(len);
      try {
        this.mod._webx68k_mem_read(addr, ptr, len);
        return new Uint8Array(this.mod.HEAPU8.subarray(ptr, ptr + len));
      } finally {
        this.mod._free(ptr);
      }
    }
    /** HostFS (feature/hostfs) 用: ゲストRAMへブロックを書く。 */
    writeGuestMemory(addr, bytes) {
      if (!this.mod._webx68k_mem_write || bytes.length === 0) return;
      const ptr = this.mod._malloc(bytes.length);
      try {
        this.mod.HEAPU8.set(bytes, ptr);
        this.mod._webx68k_mem_write(addr, ptr, bytes.length);
      } finally {
        this.mod._free(ptr);
      }
    }
    /**
     * HostFS (feature/hostfs) P2a #1: 非同期処理(listDir/readFile)が解決した"その場"で
     * 1回呼ぶ。Cの完了フラグ(mem_wrap.cのHostFsStatus)を落とし、以後の状態ポート読みが
     * JSを呼ばずに答えられるようにする。古いwasm(再ビルド前)では何もしない。
     */
    hostFsComplete() {
      this.mod._webx68k_hostfs_complete?.();
    }
    /**
     * 調査用(2026-09-04、docs/STORAGE-SCSI.md参照): console.log/log_cbを一切経由しない
     * SCSI要求カウンタをまとめて読む。「新規複数クラスタ割り当ての直後にSCSI要求が
     * 本当に来なくなっているか」を、Puppeteerのconsoleキャプチャや将来のログ上限とは
     * 無関係に確かめるためのもの。古いwasm(再ビルド前)では null を返す。
     */
    scsiDebugCounters() {
      if (!this.mod._get_scsi_req_total) return null;
      return {
        reqTotal: this.mod._get_scsi_req_total(),
        unsupported: this.mod._get_scsi_unsupported_count?.() ?? -1,
        readCount: this.mod._get_scsi_read_count?.() ?? -1,
        lastReadUnit: this.mod._get_scsi_last_read_unit?.() ?? -1,
        lastReadLogsec: this.mod._get_scsi_last_read_logsec?.() ?? -1,
        writeCount: this.mod._get_scsi_write_count?.() ?? -1,
        lastWriteUnit: this.mod._get_scsi_last_write_unit?.() ?? -1,
        lastWriteLogsec: this.mod._get_scsi_last_write_logsec?.() ?? -1,
        strategyCallCount: this.mod._get_scsi_strategy_call_count?.() ?? -1,
        interruptCallCount: this.mod._get_scsi_interrupt_call_count?.() ?? -1,
        sasiReqTotal: this.mod._get_sasi_req_total?.() ?? -1,
        sasiReadCount: this.mod._get_sasi_read_count?.() ?? -1,
        sasiLastReadLba: this.mod._get_sasi_last_read_lba?.() ?? -1,
        sasiWriteCount: this.mod._get_sasi_write_count?.() ?? -1,
        sasiLastWriteLba: this.mod._get_sasi_last_write_lba?.() ?? -1
      };
    }
    /**
     * SCSI起動 段階4(UI)是正: 自前スタブの起動エントリが実際にディスクへ制御を渡したか
     * (コア自身のラッチ、x68k/scsi.cのSCSIBootControlTransferred)。scsiDebugCounters()と
     * 違いDEVプローブの有効化フラグに関係なく常時読める(本番ビルドでもSCSIスロットの
     * ロック判定に使うため)。exportが無い古いwasm(再ビルド前)ではnullを返す。
     */
    scsiBootControlTransferred() {
      const getter = this.mod._get_scsi_boot_control_transferred;
      if (!getter) return null;
      return getter() !== 0;
    }
    /**
     * KeyBuf(128バイトのリングバッファ)の書き込みポインタと、start から count バイトぶんを
     * 読む。`test/core-keyboard-integration.test.ts` と同じ export
     * (`_webx68k_keybuf_peek` / `_webx68k_keybuf_write_pointer`) を経由する受動的な読み取りのみで、
     * 毎フレーム処理には一切関与しない。exportが無い古いwasmでは呼び出し側が判定できるよう null を返す。
     */
    readKeyBufWindow(start2, count) {
      if (!this.mod._webx68k_keybuf_peek || !this.mod._webx68k_keybuf_write_pointer) return null;
      const bytes = [];
      for (let i = 0; i < count; i++) bytes.push(this.mod._webx68k_keybuf_peek(start2 + i));
      return { writePointer: this.mod._webx68k_keybuf_write_pointer(), bytes };
    }
    /**
     * SWITCH.Xで設定されたキーリピート設定をSRAMから読む。
     * SRAM $ED003A = 開始時間の段階値(n、FIRST_KEY)、$ED003B = 間隔の段階値(n、NEXT_KEY)で、
     * それぞれkeyRepeatDelayMsFromSramValue/keyRepeatIntervalMsFromSramValueのX68000の式でmsへ変換する。
     *
     * この番地は資料の記憶ではなく実測で確定させたもの。ゲスト上でSWITCH.Xを実際に起動し、
     * その表示(FIRST_KEY 3 → 500ms、NEXT_KEY 2 → 50ms、X68000の式 開始=200+100n /
     * 間隔=30+5n^2 に一致)と、起動直後のSRAMダンプの $ED003A=0x03 / $ED003B=0x02 が
     * 一致することを突き合わせて判明した。以前はここを $ED0059 / $ED005A だと誤って読んでいた。
     * この誤りはシグネチャ照合(先頭8バイト一致)や下のnullチェック(段階値0..15の範囲内か)を
     * どちらも素通りしてしまっていた。$ED0059=0 / $ED005A=1 がたまたま0..15に収まる値だった
     * ため、「読めてはいるが番地が違う」状態を検出できず、ゲスト自身の表示と突き合わせて
     * 初めて食い違いに気づけた。番地の正しさは範囲チェックでは保証できず、実測でしか確かめられない。
     * 次のいずれかに該当すればnullを返す(呼び出し側はKeyRepeaterの既定値のまま据え置くこと):
     *   - _webx68k_sram_read が無い(古いコア・再ビルド前のwasm)
     *   - SRAM先頭が機種シグネチャ「Ｘ68000W」と一致しない(SRAM未初期化・読み出し経路の異常)
     *   - 段階値(n)が0..15の整数範囲外
     */
    readKeyRepeatConfig() {
      const mod = this.mod;
      const sramRead = mod._webx68k_sram_read;
      if (!sramRead) return null;
      for (let i = 0; i < SRAM_SIGNATURE.length; i++) {
        if (sramRead(i) !== SRAM_SIGNATURE[i]) return null;
      }
      const delayMs = keyRepeatDelayMsFromSramValue(sramRead(58));
      const intervalMs = keyRepeatIntervalMsFromSramValue(sramRead(59));
      if (delayMs === null || intervalMs === null) return null;
      return { delayMs, intervalMs };
    }
    /**
     * SRAM全体(0x4000バイト、$ED0000-$ED3FFFに対応)を読み出す。
     * 先頭8バイトが機種シグネチャ「Ｘ68000W」と一致しない場合はnullを返す
     * (readKeyRepeatConfig()と同じ健全性チェック)。ここでnullを弾かずに保存してしまうと、
     * 未初期化・読み出し経路異常のSRAMをそのまま永続化することになり、次回起動時に
     * その壊れたSRAMを読み込んで正常な状態へ戻れなくなってしまう。
     */
    readSram() {
      const mod = this.mod;
      const sramRead = mod._webx68k_sram_read;
      if (!sramRead) return null;
      for (let i = 0; i < SRAM_SIGNATURE.length; i++) {
        if (sramRead(i) !== SRAM_SIGNATURE[i]) return null;
      }
      const bytes = new Uint8Array(16384);
      for (let i = 0; i < 16384; i++) bytes[i] = sramRead(i);
      return bytes;
    }
    /**
     * SRAMを定期的に読み、前回保存した内容から変化していれば save() を呼ぶ。
     * 離脱イベント(beforeunload/pagehide)に保存を託さない設計にしている
     * (非同期処理を完走できないことがあり、過去にそれで保存し損ねた実績があるため)。
     * 代わりに平常時、短い間隔(3秒)で読み直して差分があれば保存する。
     * SWITCH.Xの設定はユーザーが明示的に変更したときしか変わらないため、
     * 16KB全バイト比較をこの頻度で行っても無駄が大きくない(毎フレーム=60Hzで
     * やる必要はない)。同名タイマーが既にあれば張り替える。
     */
    startSramAutosave(save) {
      this.stopSramAutosave();
      this.sramAutosaveTimer = setInterval(() => {
        const bytes = this.readSram();
        if (!bytes) return;
        if (this.lastSavedSram && bytesEqual2(this.lastSavedSram, bytes)) return;
        this.lastSavedSram = bytes;
        save(bytes);
      }, 3e3);
    }
    /** SRAM定期保存を止める(dispose時・テスト後始末用)。 */
    stopSramAutosave() {
      if (this.sramAutosaveTimer !== null) {
        clearInterval(this.sramAutosaveTimer);
        this.sramAutosaveTimer = null;
      }
    }
    readGuestCursor() {
      const mod = this.mod;
      const word = (addr) => {
        const v = mod._webx68k_peek16(addr);
        return v >= 32768 ? v - 65536 : v;
      };
      const x = word(2766);
      const y = word(2768);
      const minX = word(2714);
      const minY = word(2716);
      const maxX = word(2718);
      const maxY = word(2720);
      if (maxX <= minX || maxY <= minY) return null;
      return { x, y, minX, minY, maxX, maxY, visible: mod._webx68k_peek8(2722) !== 0 };
    }
    /** キャプチャ解除時などに、積み残しのデルタとボタン押下状態を捨てる */
    clearMouseState() {
      this.mouseDx = 0;
      this.mouseDy = 0;
      this.mouseButtons.left = false;
      this.mouseButtons.right = false;
    }
    /**
     * コア内部のマウス状態を覗く(配線確認用)。
     * dx/dy はコアが溜めている累積デルタで、ゲストが SCC 経由でポーリングしたときに 0 へ吸われる。
     * enabled は px68k の MouseSW で、コアオプション px68k_joy_mouse が "Mouse" のときに 1 になる。
     */
    readMouseState() {
      const mod = this.mod;
      return {
        dx: mod._get_mouse_dx(),
        dy: mod._get_mouse_dy(),
        stat: mod._get_mouse_stat(),
        enabled: mod._get_mouse_enabled() !== 0,
        // ゲストがポーリングした時点で累積デルタがこちらへ移る(SCC へ渡る実値)
        sccX: mod._get_mouse_scc_x(),
        sccY: mod._get_mouse_scc_y(),
        sccStat: mod._get_mouse_scc_stat()
      };
    }
    /**
     * コアオプション(px68k_cpuspeed 等)を設定する。init() 前後どちらでも呼べる。
     * 値変更時は該当キーの malloc 済み文字列キャッシュを破棄し、次回 GET_VARIABLE で再 malloc させる
     * (キャッシュを残すと古い文字列ポインタを返し続けてしまうため)。
     */
    setCoreOption(key, value) {
      if (this.coreOptions.get(key) !== value && LIVE_UPDATABLE_CORE_OPTIONS.has(key))
        this.coreOptionsDirty = true;
      this.coreOptions.set(key, value);
      const oldPtr = this.coreOptionPtrs.get(key);
      if (oldPtr !== void 0) {
        this.coreOptionPtrs.delete(key);
        if (this.mod) this.mod._free(oldPtr);
      }
    }
    /**
     * BIOS ファイル(と、あれば SRAM)を書き込み、コアを初期化する。
     * SRAM_Init()(x68k/sram.c)は sram.dat を retro_load_game() の中(WinX68k_Init()経由)で
     * 読むため、ここ(retro_load_game() より確実に前)で書いておく必要がある。長さが
     * 0x4000(16KB)でないものは壊れたデータを渡さないよう無視する(未初期化 0xFF 埋めの
     * ままIPLに既定値を書かせたほうが安全なため)。
     */
    async init(biosIpl, biosCg, sram, coreBaseUrl) {
      const resolvedCoreBaseUrl = coreBaseUrl ?? (typeof document !== "undefined" ? new URL("core/", document.baseURI).href : typeof self !== "undefined" ? new URL("../core/", self.location.href).href : "core/");
      const mod = await getPX68KFactory()({
        locateFile: (path) => path.endsWith(".wasm") ? `${resolvedCoreBaseUrl}${path}?v=${"webx68k-96abd36"}` : `${resolvedCoreBaseUrl}${path}`
      });
      this.mod = mod;
      this.mkdirSafe("/system");
      this.mkdirSafe("/system/keropi");
      this.mkdirSafe("/save");
      this.mkdirSafe("/game");
      probedMemfsWrite(mod, "rom-ipl", "/system/keropi/iplrom.dat", biosIpl);
      this.coreCgrom = biosCg.slice();
      probedMemfsWrite(mod, "rom-cg", "/system/keropi/cgrom.dat", this.coreCgrom);
      if (sram) {
        if (sram.byteLength === 16384) {
          mod.FS.writeFile("/system/keropi/sram.dat", sram);
        } else {
          console.warn(
            `SRAM\u30D5\u30A1\u30A4\u30EB\u306E\u30B5\u30A4\u30BA\u304C\u4E0D\u6B63\u3067\u3059(${sram.byteLength} bytes, \u671F\u5F85\u5024 0x4000): \u7121\u8996\u3057\u307E\u3059`
          );
        }
      }
      this.systemDirPtr = mallocString(mod, "/system");
      this.saveDirPtr = mallocString(mod, "/save");
      this.registerCallbacks();
      mod._retro_init();
    }
    mkdirSafe(path) {
      try {
        this.mod ? this.mod.FS.mkdir(path) : void 0;
      } catch {
      }
    }
    registerCallbacks() {
      const mod = this.mod;
      const environmentCb = (cmd, data) => this.handleEnvironment(cmd, data);
      const videoRefreshCb = (data, width, height, pitch) => this.handleVideoRefresh(data, width, height, pitch);
      const audioSampleCb = (left, right) => {
        if (!this.audioMuted) this.audioPush(new Float32Array([left / 32768, right / 32768]));
      };
      const audioSampleBatchCb = (data, frames) => this.handleAudioBatch(data, frames);
      this.keyStatePtr = mod._webx68k_get_key_state?.() ?? 0;
      if (this.keyStatePtr) {
        mod.HEAPU8.fill(0, this.keyStatePtr, this.keyStatePtr + 512);
        for (const key of this.keyState) {
          if (Number.isInteger(key) && key >= 0 && key < 512) this.dirtyKeys.add(key);
        }
      }
      const syncKeys = () => {
        if (this.keyStatePtr && this.dirtyKeys.size) {
          for (const key of this.dirtyKeys) {
            mod.HEAPU8[this.keyStatePtr + key] = this.keyState.has(key) ? 128 : 0;
          }
          this.dirtyKeys.clear();
        }
      };
      const inputPollCb = () => {
        this.onPoll?.();
        syncKeys();
      };
      const inputStateCb = (port, device, _index, id) => {
        if (device === RETRO_DEVICE_KEYBOARD) return this.keyState.has(id) ? 1 : 0;
        if (device === RETRO_DEVICE_MOUSE) {
          switch (id) {
            case RETRO_DEVICE_ID_MOUSE_X: {
              const step = clampStep(this.mouseDx);
              this.mouseDx -= step;
              return step;
            }
            case RETRO_DEVICE_ID_MOUSE_Y: {
              const step = clampStep(this.mouseDy);
              this.mouseDy -= step;
              return step;
            }
            case RETRO_DEVICE_ID_MOUSE_LEFT:
              return this.mouseButtons.left ? 1 : 0;
            case RETRO_DEVICE_ID_MOUSE_RIGHT:
              syncKeys();
              return this.mouseButtons.right ? 1 : 0;
            default:
              return 0;
          }
        }
        if (device === RETRO_DEVICE_JOYPAD) {
          if (port !== 0 && port !== 1) return 0;
          return this.joyState[port] >> id & 1;
        }
        return 0;
      };
      const environmentPtr = mod.addFunction(environmentCb, "iii");
      const videoRefreshPtr = mod.addFunction(videoRefreshCb, "viiii");
      const audioSamplePtr = mod.addFunction(audioSampleCb, "vii");
      const audioSampleBatchPtr = mod.addFunction(audioSampleBatchCb, "iii");
      const inputPollPtr = mod.addFunction(inputPollCb, "v");
      const inputStatePtr = mod.addFunction(inputStateCb, "iiiii");
      this.callbackPtrs = [
        environmentPtr,
        videoRefreshPtr,
        audioSamplePtr,
        audioSampleBatchPtr,
        inputPollPtr,
        inputStatePtr
      ];
      mod._retro_set_environment(environmentPtr);
      mod._retro_set_video_refresh(videoRefreshPtr);
      mod._retro_set_audio_sample(audioSamplePtr);
      mod._retro_set_audio_sample_batch(audioSampleBatchPtr);
      mod._retro_set_input_poll(inputPollPtr);
      mod._retro_set_input_state(inputStatePtr);
    }
    handleEnvironment(cmd, data) {
      const mod = this.mod;
      switch (cmd) {
        case RETRO_ENVIRONMENT_GET_CAN_DUPE:
          mod.HEAPU8[data] = 1;
          return 1;
        case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
          mod.HEAP32[data >> 2] = this.systemDirPtr;
          return 1;
        case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
          mod.HEAP32[data >> 2] = this.saveDirPtr;
          return 1;
        case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
          const fmt = mod.HEAP32[data >> 2];
          return fmt === RETRO_PIXEL_FORMAT_RGB565 ? 1 : 0;
        }
        case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
          return 1;
        case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
          this._avInfo = this.parseAvInfo(data);
          return 1;
        }
        case RETRO_ENVIRONMENT_SET_GEOMETRY: {
          if (this._avInfo) {
            this._avInfo.baseWidth = mod.HEAP32[data >> 2];
            this._avInfo.baseHeight = mod.HEAP32[data + 4 >> 2];
            this._avInfo.maxWidth = mod.HEAP32[data + 8 >> 2];
            this._avInfo.maxHeight = mod.HEAP32[data + 12 >> 2];
            this._avInfo.aspectRatio = mod.HEAPF32[data + 16 >> 2];
          }
          return 1;
        }
        case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
          mod.HEAP32[data >> 2] = mod._get_retro_log_shim();
          return 1;
        case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: {
          mod.HEAPU8[data] = this.coreOptionsDirty ? 1 : 0;
          this.coreOptionsDirty = false;
          return 1;
        }
        case RETRO_ENVIRONMENT_GET_VARIABLE: {
          const keyPtr = mod.HEAP32[data >> 2];
          if (!keyPtr) return 0;
          const key = mod.UTF8ToString(keyPtr);
          const value = this.coreOptions.get(key);
          if (value === void 0) return 0;
          let valPtr = this.coreOptionPtrs.get(key);
          if (!valPtr) {
            valPtr = mallocString(mod, value);
            this.coreOptionPtrs.set(key, valPtr);
          }
          mod.HEAP32[data + 4 >> 2] = valPtr;
          return 1;
        }
        case RETRO_ENVIRONMENT_SET_VARIABLES:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL:
        case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
        case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK:
        case RETRO_ENVIRONMENT_SET_DISK_CONTROL_INTERFACE:
        case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
          return 1;
        default:
          return 0;
      }
    }
    /** 無制限速度モード用: 中間フレームの描画をスキップするか切り替える。 */
    setVideoSkip(skip) {
      this.videoSkip = skip;
    }
    handleVideoRefresh(data, width, height, pitch) {
      const changed = this.mod._webx68k_video_changed?.() ?? 1;
      this.videoPending ||= !!changed || data !== 0 && data !== this.lastVideoPointer || width !== this.lastWidth || height !== this.lastHeight;
      if (data) this.lastVideoPointer = data;
      if ((this.videoHidden || this.videoSkip) && changed && this.mod._webx68k_video_skip) {
        this.videoCompositionDeferred = true;
      }
      if (this.videoHidden) {
        if (data && width && height) {
          this.hiddenFrame = { data, width, height, pitch };
        }
        return;
      }
      if (this.videoSkip) return;
      if (!data || !width || !height) return;
      if (this.videoPending) {
        this.convertVideoFrame(data, width, height, pitch);
        this.videoPending = false;
        this.videoCompositionDeferred = false;
      }
    }
    convertVideoFrame(data, width, height, pitch) {
      const probing = false;
      const frameIndex = probing ? Math.max(0, frameProbe.frameCounter - 1) : 0;
      if (data === 0 || width === 0 || height === 0) {
        if (probing) {
          frameProbe.videoEvents.push({
            frameIndex,
            dupe: true,
            width,
            height,
            fps: this.avInfo?.fps ?? null,
            convertStartAtMs: performance.now(),
            convertEndAtMs: null,
            putStartAtMs: null,
            putEndAtMs: null
          });
        }
        return;
      }
      if (width !== this.lastWidth || height !== this.lastHeight) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.imageData = this.acquireVideoBuffer ? null : this.ctx2d.createImageData(width, height);
        this.imageData32 = this.imageData ? new Uint32Array(this.imageData.data.buffer) : null;
        this.lastWidth = width;
        this.lastHeight = height;
        this.onResolutionChanged?.();
      }
      const img = this.imageData;
      const out32 = this.acquireVideoBuffer ? new Uint32Array(this.acquireVideoBuffer(width, height)) : this.imageData32;
      if (!out32) return;
      if (!rgb565Lut) rgb565Lut = buildRgb565Lut(LITTLE_ENDIAN);
      const lut = rgb565Lut;
      const convertStartAtMs = probing ? performance.now() : 0;
      const src16 = this.mod.HEAPU16;
      const base = data >> 1;
      const strideSamples = pitch >> 1;
      for (let y = 0; y < height; y++) {
        let srcIdx = base + y * strideSamples;
        let dstIdx = y * width;
        for (let x = 0; x < width; x++) {
          out32[dstIdx++] = lut[src16[srcIdx++]];
        }
      }
      if (!probing) {
        if (img) this.ctx2d.putImageData(img, 0, 0);
        this.onFramePresented?.();
        return;
      }
      const convertEndAtMs = performance.now();
      const putStartAtMs = performance.now();
      if (img) this.ctx2d.putImageData(img, 0, 0);
      this.onFramePresented?.();
      const putEndAtMs = performance.now();
      frameProbe.videoEvents.push({
        frameIndex,
        dupe: false,
        width,
        height,
        fps: this.avInfo?.fps ?? null,
        convertStartAtMs,
        convertEndAtMs,
        putStartAtMs,
        putEndAtMs
      });
    }
    handleAudioBatch(data, frames) {
      if (frames <= 0 || this.audioMuted) return frames;
      const mod = this.mod;
      const base = data >> 1;
      const count = frames * 2;
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const sample = mod.HEAP16[base + i] / 32768;
        out[i] = sample;
        if (false) {
          const abs = sample < 0 ? -sample : sample;
          if (abs > this.audioProbeMaxAbs) this.audioProbeMaxAbs = abs;
          if (abs > AUDIO_PROBE_NON_SILENT_THRESHOLD) this.audioProbeNonSilentCount++;
          this.audioProbeSampleCount++;
        }
      }
      this.audioPush(out);
      return frames;
    }
    /**
     * 音声振幅プローブを初期化する。予備確認(音声遅延の陰性/陽性対照)で、操作前後の
     * 積算区間を切り分けるために使う。呼び出し自体はカウンタのリセットのみで、
     * オーディオコールバックの動作には関与しない。
     */
    resetAudioProbe() {
      this.audioProbeMaxAbs = 0;
      this.audioProbeSampleCount = 0;
      this.audioProbeNonSilentCount = 0;
    }
    /**
     * 直前の resetAudioProbe() 以降にコアが生成した音声サンプルの最大振幅(絶対値、0..1)、
     * サンプル総数、非無音サンプル数(しきい値 AUDIO_PROBE_NON_SILENT_THRESHOLD 超)を返す。
     * queuedSec(AudioWorkletの未再生キュー時間)と異なり、無音サンプルもキューには積まれる
     * ため区別できない問題を避けるための、コア出力そのものの受動的な読み取り。
     */
    readAudioProbe() {
      return {
        maxAbs: this.audioProbeMaxAbs,
        sampleCount: this.audioProbeSampleCount,
        nonSilentCount: this.audioProbeNonSilentCount,
        threshold: AUDIO_PROBE_NON_SILENT_THRESHOLD
      };
    }
    /** 任意のバイト列を FS の指定パスへ書き込む(既存ファイルがあれば上書き) */
    writeFile(path, data) {
      try {
        this.mod.FS.unlink(path);
      } catch {
      }
      this.mod.FS.writeFile(path, data);
    }
    /** FS 上のファイルを削除する(存在しなければ何もしない) */
    removeFile(path) {
      try {
        this.mod.FS.unlink(path);
      } catch {
      }
    }
    /** ディスクイメージのバイト列を FS の /game 配下へ書き込み、パスを返す */
    writeDiskImage(filename, data) {
      const path = `/game/${filename}`;
      const kind = filename.startsWith("fdd0_") ? "fdd0" : filename.startsWith("fdd1_") ? "fdd1" : filename.startsWith("hdd_") ? "hdd" : null;
      if (kind && false) {
        try {
          this.mod.FS.unlink(path);
        } catch {
        }
        probedMemfsWrite(this.mod, kind, path, data);
      } else {
        this.writeFile(path, data);
      }
      return path;
    }
    /**
     * FS 上の指定パスのファイルを読み出す(ダウンロード用)。
     * コアはディスクイメージを /game 配下のファイルへ直接書き換えるため、
     * ゲスト側で書き込んだ内容を含む最新バイト列を取得できる。
     */
    readFile(path) {
      return this.mod.FS.readFile(path);
    }
    /** ディスク未指定でコンテンツ無し起動 */
    loadGameNone() {
      return this.mod._retro_load_game(0) !== 0;
    }
    loadGame(path) {
      const mod = this.mod;
      const pathPtr = mallocString(mod, path);
      const infoPtr = mod._malloc(16);
      mod.HEAP32[infoPtr >> 2] = pathPtr;
      mod.HEAP32[infoPtr + 4 >> 2] = 0;
      mod.HEAP32[infoPtr + 8 >> 2] = 0;
      mod.HEAP32[infoPtr + 12 >> 2] = 0;
      const ok = mod._retro_load_game(infoPtr) !== 0;
      mod._free(infoPtr);
      mod._free(pathPtr);
      return ok;
    }
    unloadGame() {
      this.hiddenFrame = null;
      this.mod._retro_unload_game();
    }
    /** retro_system_av_info 構造体(geometry 20byte + 4byte pad + timing 16byte)を読み出す */
    parseAvInfo(ptr) {
      const mod = this.mod;
      return {
        baseWidth: mod.HEAP32[ptr >> 2],
        baseHeight: mod.HEAP32[ptr + 4 >> 2],
        maxWidth: mod.HEAP32[ptr + 8 >> 2],
        maxHeight: mod.HEAP32[ptr + 12 >> 2],
        aspectRatio: mod.HEAPF32[ptr + 16 >> 2],
        fps: mod.HEAPF64[ptr + 24 >> 3],
        sampleRate: mod.HEAPF64[ptr + 32 >> 3]
      };
    }
    fetchAvInfo() {
      const mod = this.mod;
      const ptr = mod._malloc(40);
      mod._retro_get_system_av_info(ptr);
      const info = this.parseAvInfo(ptr);
      mod._free(ptr);
      this._avInfo = info;
      return info;
    }
    /**
     * 実行中の FDD ディスク差し替え(ホットマウント)。
     * path が空文字列なら取り出し。コア再起動を伴わずに実機同様のメディア交換になる。
     */
    setFddImage(drive, path) {
      const mod = this.mod;
      if (!path) {
        mod._webx68k_fdd_eject(drive);
        return;
      }
      const pathPtr = mallocString(mod, path);
      try {
        mod._webx68k_fdd_insert(drive, pathPtr);
      } finally {
        mod._free(pathPtr);
      }
    }
    reset() {
      this.hiddenFrame = null;
      this.mod._retro_reset();
    }
    /**
     * 現在の実行状態をシリアライズして返す(ステートセーブ)。
     * px68k-libretro 側は RAM/SRAM/CPU/VRAM/CRTC/DMAC/MFP/FDC/FDD/SASI/OPM/ADPCM 等を保存するが、
     * **ディスクイメージの中身とマウントパスは含まれない**。ロード時は同じディスクが
     * 挿さっている前提になるため、呼び出し側でスロット構成を別途記録して照合すること。
     */
    serialize() {
      return serializeCoreState(this.mod);
    }
    /** シリアライズ済みの状態を復元する(ステートロード)。成功したら true。 */
    unserialize(bytes) {
      this.hiddenFrame = null;
      const mod = this.mod;
      if (!mod || bytes.length === 0) return false;
      return unserializeCoreState(mod, bytes);
    }
    runFrame() {
      this.mod._webx68k_video_skip?.(this.videoSkip || this.videoHidden ? 1 : 0);
      if (false) {
        const frameIndex = frameProbe.frameCounter++;
        const runStartAtMs = performance.now();
        this.mod._retro_run();
        const runEndAtMs = performance.now();
        let busyWaitInjectedMs = 0;
        if (frameProbe.busyWaitFaultEnabled && frameIndex % 60 === 0) {
          busyWaitInjectedMs = 50;
          const until = performance.now() + busyWaitInjectedMs;
          while (performance.now() < until) {
          }
        }
        frameProbe.runEvents.push({ frameIndex, runStartAtMs, runEndAtMs, busyWaitInjectedMs });
        return;
      }
      if (false) {
        this.mod._retro_run();
        keybufAttributionProbe2.frameNo++;
        const writePointer = this.mod._webx68k_keybuf_write_pointer ? this.mod._webx68k_keybuf_write_pointer() : void 0;
        if (writePointer !== void 0) {
          keybufAttributionProbe2.tracker = trackKeyBufWrite(
            keybufAttributionProbe2.tracker,
            writePointer,
            keybufAttributionProbe2.frameNo
          );
        }
        return;
      }
      this.mod._retro_run();
    }
    /** コアモジュールの初期化が完了しているか。 */
    isInitialized() {
      return this.mod !== void 0;
    }
    hasSerialBridge() {
      const mod = this.mod;
      return Boolean(
        mod?._webx68k_serial_rx && mod._webx68k_serial_tx_available && mod._webx68k_serial_tx_drain && mod._webx68k_serial_reset && mod._webx68k_serial_set_connected && mod._webx68k_serial_set_tx_writable && mod._webx68k_serial_guest_baud_rate
      );
    }
    /** ホストから受け取ったバイト列を SCC チャネルAの受信FIFOへ渡す。戻り値は受理したバイト数。 */
    serialReceive(bytes) {
      if (bytes.length === 0) return 0;
      const mod = this.mod;
      if (!mod) return 0;
      const receive = mod._webx68k_serial_rx;
      if (!receive) return 0;
      const ptr = this.ensureSerialBridgeBuffer();
      if (!ptr) return 0;
      let accepted = 0;
      while (accepted < bytes.length) {
        const length = Math.min(this.serialBridgeCapacity, bytes.length - accepted);
        mod.HEAPU8.set(bytes.subarray(accepted, accepted + length), ptr);
        const count = receive(ptr, length);
        if (count <= 0) break;
        accepted += count;
        if (count < length) break;
      }
      return accepted;
    }
    /** エミュレートされた SCC の送信FIFOから、最大 maxBytes バイトを取り出す。 */
    drainSerialTx(maxBytes = this.serialBridgeCapacity) {
      const mod = this.mod;
      if (!mod) return new Uint8Array(0);
      const available = mod._webx68k_serial_tx_available;
      const drain = mod._webx68k_serial_tx_drain;
      if (!available || !drain) return new Uint8Array(0);
      const count = Math.min(Math.max(0, maxBytes), this.serialBridgeCapacity, Math.max(0, available()));
      if (count === 0) return new Uint8Array(0);
      const ptr = this.ensureSerialBridgeBuffer();
      if (!ptr) return new Uint8Array(0);
      const written = drain(ptr, count);
      if (written <= 0) return new Uint8Array(0);
      return new Uint8Array(mod.HEAPU8.subarray(ptr, ptr + Math.min(written, count)));
    }
    resetSerialBridge() {
      this.mod?._webx68k_serial_reset?.();
    }
    setSerialConnected(connected) {
      this.mod?._webx68k_serial_set_connected?.(connected ? 1 : 0);
    }
    setSerialTxWritable(writable) {
      this.mod?._webx68k_serial_set_tx_writable?.(writable ? 1 : 0);
    }
    serialGuestBaudRate() {
      return this.mod?._webx68k_serial_guest_baud_rate?.() ?? 0;
    }
    ensureSerialBridgeBuffer() {
      if (!this.serialBridgePtr) this.serialBridgePtr = this.mod._malloc(this.serialBridgeCapacity);
      return this.serialBridgePtr;
    }
    /**
     * 直近の runFrame() でディスクアクセスがあったかを取得する(アクセスランプ用)。
     * fdd.c 側は FDD_IsReading/FDD_AccessDrive を retro_run() の毎フレーム先頭で0クリアするため、
     * runFrame() 呼び出し直後に読まないと取りこぼす。
     */
    readDiskAccess() {
      const mod = this.mod;
      return {
        fddReading: mod._get_fdd_is_reading() !== 0,
        fddDrive: mod._get_fdd_access_drive(),
        hddAccessing: mod._get_sasi_is_accessing() !== 0
      };
    }
    /**
     * ゲストがディスクへ書き込んだか(オートセーブ用のダーティフラグ)。
     * アクセスランプ用のフラグと違い、コアは自動でクリアしないので、
     * ホストが保存を終えるまで立ち続ける。
     */
    readDirtyState() {
      const mod = this.mod;
      return { fddMask: mod._get_fdd_dirty_mask(), hdd: mod._get_sasi_dirty() !== 0 };
    }
    /**
     * ダーティフラグを落とす。
     * 吸い出しの「直前」に呼ぶこと。吸い出した後にクリアすると、吸い出し中に
     * 発生した書き込みまで一緒に消してしまい、その分が保存されなくなる。
     */
    clearDirty(target) {
      if (target.fddDrive !== void 0) this.mod._clear_fdd_dirty(target.fddDrive);
      if (target.hdd) this.mod._clear_sasi_dirty();
    }
    /** コールバック用関数テーブルエントリを解放する */
    dispose() {
      this.hiddenFrame = null;
      this.stopSramAutosave();
      this.setSerialConnected(false);
      if (this.serialBridgePtr) {
        this.mod._free(this.serialBridgePtr);
        this.serialBridgePtr = 0;
      }
      for (const ptr of this.callbackPtrs) {
        this.mod.removeFunction(ptr);
      }
      this.callbackPtrs = [];
    }
  };
  function bytesEqual2(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // src/features/x68000/media.js
  var MEDIA = /\.(dim|img|d88|88d|hdm|dup|2hd|xdf|hdf|cmd|m3u)$/i;
  function prepareX68000Media(message) {
    const bytes = new Uint8Array(message.bytes || []);
    let files = /\.zip$/i.test(message.fileName || "") ? Object.entries(unzipSync(bytes)).map(([fileName, data]) => ({ fileName, bytes: data })) : message.files?.length ? message.files : [{ fileName: message.fileName, bytes }];
    files = files.map((file) => {
      const fileName = String(file.fileName || "").replaceAll("\\", "/");
      if (fileName.startsWith("/") || fileName.split("/").some((part) => part === ".." || part === ".")) {
        throw new Error("The game contains an unsafe disk path.");
      }
      return { fileName, bytes: new Uint8Array(file.bytes || []) };
    }).filter((file) => MEDIA.test(file.fileName) && file.bytes.length);
    if (!files.length) throw new Error("No supported X68000 disk images found.");
    const selected = files.find((file) => /\.(m3u|cmd)$/i.test(file.fileName)) || files.find((file) => /\.hdf$/i.test(file.fileName));
    if (selected || files.length === 1) return { files, primary: (selected || files[0]).fileName };
    const playlist = "osg-disks.m3u";
    return {
      files: [...files, { fileName: playlist, bytes: new TextEncoder().encode(files.map((file) => file.fileName).join("\n")) }],
      primary: playlist
    };
  }
  function x68000JoyBits(mask) {
    return [[1, 4], [2, 5], [4, 6], [8, 7], [16, 8], [32, 0], [64, 3], [128, 2]].reduce((bits2, [source, target]) => bits2 | (mask & source ? 1 << target : 0), 0);
  }
  function x68000KeyboardJoystickBit(key) {
    const keys = { ArrowUp: 1, q: 1, ArrowDown: 2, a: 2, ArrowLeft: 4, o: 4, ArrowRight: 8, p: 8, x: 16, f: 16, z: 32, g: 32, Enter: 64, c: 128 };
    return keys[key] || keys[String(key).toLowerCase()] || 0;
  }

  // src/features/x68000/launcher.js
  var canvas = document.getElementById("pcengine-screen");
  var context = canvas.getContext("2d", { alpha: false });
  var firmware;
  var currentGame;
  var host;
  var generation = 0;
  var animation;
  var paused = false;
  var audio;
  var destination;
  var gain;
  var nextAudioTime = 0;
  var audioSources = /* @__PURE__ */ new Set();
  var keyboardMasks = [0, 0];
  var controllerMasks = [0, 0];
  var pressedKeys = /* @__PURE__ */ new Set();
  var state = { engine: "WebX68k", ramMb: 12, frameCount: 0, running: false, paused: false, error: "" };
  window.x68000Runtime = state;
  function trace(stage, detail = "") {
    const entry = { stage, detail: String(detail), timestamp: (/* @__PURE__ */ new Date()).toISOString() };
    console.log(`[WebX68k] ${stage}`, detail);
    try {
      localStorage.setItem("osg-px68k-last-trace", JSON.stringify(entry));
    } catch {
    }
    window.parent.postMessage({ type: "x68000_trace", ...entry }, location.origin);
  }
  function status(title, detail = "") {
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.fillStyle = "#fff";
    context.font = "24px system-ui";
    context.fillText(title, canvas.width / 2, canvas.height / 2 - 15);
    context.font = "16px system-ui";
    context.fillText(detail, canvas.width / 2, canvas.height / 2 + 20);
  }
  function ensureAudio() {
    if (!audio) {
      audio = new AudioContext({ sampleRate: 44100 });
      destination = audio.createMediaStreamDestination();
      gain = audio.createGain();
      gain.connect(audio.destination);
      gain.connect(destination);
    }
    return audio;
  }
  window.getX68000AudioStream = window.getPcEngineAudioStream = () => {
    ensureAudio().resume().catch(() => {
    });
    return destination.stream;
  };
  function stopAudio() {
    for (const source of audioSources) {
      try {
        source.stop();
      } catch {
      }
    }
    audioSources.clear();
    nextAudioTime = 0;
  }
  function pushAudio(samples) {
    if (!audio || audio.state !== "running" || paused || nextAudioTime > audio.currentTime + 0.25) return;
    const frames = samples.length / 2;
    const buffer = audio.createBuffer(2, frames, host?.avInfo?.sampleRate || 44100);
    for (let channel = 0; channel < 2; channel++) {
      const output = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i++) output[i] = samples[i * 2 + channel];
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.onended = () => {
      audioSources.delete(source);
      source.disconnect();
    };
    audioSources.add(source);
    nextAudioTime = Math.max(audio.currentTime + 0.02, nextAudioTime);
    source.start(nextAudioTime);
    nextAudioTime += buffer.duration;
  }
  function stop() {
    cancelAnimationFrame(animation);
    stopAudio();
    state.running = false;
    if (host) {
      host.unloadGame();
      host = null;
    }
  }
  function fail(error) {
    stop();
    state.error = error.message || String(error);
    trace("runtime-error", state.error);
    status("X68000 could not start", state.error);
  }
  async function start() {
    if (!currentGame) return;
    if (!firmware) {
      status("X68000 firmware required", "Load iplrom.dat and cgrom.dat from the room controls");
      return;
    }
    const token = ++generation;
    stop();
    state.error = "";
    status("Loading Sharp X68000", currentGame.fileName);
    let nextHost;
    try {
      let tick = function(now) {
        if (token !== generation) return;
        try {
          if (paused) nextFrame = now;
          else {
            const deadline = performance.now() + 8;
            const frameMs = 1e3 / (host.avInfo?.fps || 59.94);
            let count = 0;
            if (now - nextFrame > 100) nextFrame = now;
            while (now >= nextFrame && count++ < 4) {
              host.runFrame();
              state.frameCount++;
              nextFrame += frameMs;
              if (performance.now() >= deadline) break;
            }
            if (state.frameCount >= 60 && !state.firstFramesVerified) {
              state.firstFramesVerified = true;
              trace("emulation-running", `${state.frameCount} frames completed`);
            }
          }
          animation = requestAnimationFrame(tick);
        } catch (error) {
          fail(error);
        }
      };
      const media = prepareX68000Media(currentGame);
      nextHost = new LibretroHost(canvas, pushAudio);
      nextHost.setCoreOption("px68k_cpuspeed", "16Mhz");
      nextHost.setCoreOption("px68k_ramsize", "12MB");
      nextHost.setCoreOption("px68k_no_wait_mode", "enabled");
      nextHost.setCoreOption("px68k_save_fdd_path", "disabled");
      nextHost.setCoreOption("px68k_save_hdd_path", "disabled");
      await nextHost.init(firmware.ipl, firmware.cg, void 0, `${location.origin}/x68000/webx68k/`);
      if (token !== generation) return;
      for (const file of media.files) nextHost.writeDiskImage(file.fileName, file.bytes);
      if (!nextHost.loadGame(`/game/${media.primary}`)) throw new Error("The X68000 core rejected this game image.");
      host = nextHost;
      state.running = true;
      state.frameCount = 0;
      trace("game-loaded", `${media.primary}; ${media.files.length} media files`);
      let nextFrame = performance.now();
      state.firstFramesVerified = false;
      animation = requestAnimationFrame(tick);
    } catch (error) {
      if (token === generation) fail(error);
    }
  }
  var keyCodes = { Enter: 13, Escape: 27, Backspace: 8, Tab: 9, " ": 32, ArrowUp: 273, ArrowDown: 274, ArrowRight: 275, ArrowLeft: 276, Insert: 277, Home: 278, End: 279, PageUp: 280, PageDown: 281, Delete: 127, CapsLock: 301, Shift: 304, Control: 306, Alt: 308 };
  function updateJoystick(port) {
    host?.setJoyState(port, x68000JoyBits(keyboardMasks[port] | controllerMasks[port]));
  }
  function clearInputs() {
    for (const key of pressedKeys) host?.setKey(key, false);
    pressedKeys.clear();
    keyboardMasks.fill(0);
    controllerMasks.fill(0);
    updateJoystick(0);
    updateJoystick(1);
    host?.clearMouseState();
  }
  function keyInput(key, down, player = 1) {
    const code = keyCodes[key] ?? (/^F(?:[1-9]|1[0-2])$/.test(key) ? 281 + Number(key.slice(1)) : key?.length === 1 ? key.toLowerCase().charCodeAt(0) : null);
    if (code != null) {
      if (down) pressedKeys.add(code);
      else pressedKeys.delete(code);
      host?.setKey(code, down);
    }
    const bit = x68000KeyboardJoystickBit(key);
    const port = player === 2 ? 1 : 0;
    keyboardMasks[port] = down ? keyboardMasks[port] | bit : keyboardMasks[port] & ~bit;
    updateJoystick(port);
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent && event.source !== window) return;
    const message = event.data || {};
    try {
      if (message.type === "x68000_firmware") {
        const files = message.files?.length ? message.files : Object.entries(unzipSync(new Uint8Array(message.bytes))).map(([fileName, bytes]) => ({ fileName, bytes }));
        const find = (name) => files.find((file) => file.fileName.replaceAll("\\", "/").split("/").pop().toLowerCase() === name)?.bytes;
        const ipl = new Uint8Array(find("iplrom.dat") || []);
        const cg = new Uint8Array(find("cgrom.dat") || []);
        if (![131072, 262144].includes(ipl.length) || cg.length !== 786432) throw new Error("X68000 needs a 128/256 KB IPL ROM and 768 KB CG ROM.");
        if (firmware && firmware.ipl.length === ipl.length && firmware.ipl.every((v, i) => v === ipl[i]) && firmware.cg.every((v, i) => v === cg[i])) return;
        firmware = { ipl, cg };
        trace("firmware-ready");
        start();
      } else if (message.type === "x68000_autoload") {
        currentGame = message;
        start();
      } else if (message.type === "x68000_start" || message.type === "amstrad_audio_unlock") {
        window.getX68000AudioStream();
      } else if (message.type === "x68000_reset") {
        start();
      } else if (message.type === "emulator_set_volume") {
        ensureAudio();
        gain.gain.value = Math.max(0, Math.min(1, Number(message.volume) || 0));
      } else if (message.type === "emulator_set_paused") {
        paused = Boolean(message.paused);
        state.paused = paused;
        clearInputs();
        stopAudio();
      } else if (message.type === "amstrad_remote_joystick") {
        const port = message.player === 2 ? 1 : 0;
        controllerMasks[port] = Number(message.mask) || 0;
        updateJoystick(port);
      } else if (message.type === "amstrad_remote_input" || message.type === "amstrad_remote_control") {
        keyInput(message.key, message.action === "down", message.player);
      } else if (message.type === "amiga_mouse_move") {
        host?.addMouseDelta(Number(message.movementX) || 0, Number(message.movementY) || 0);
      } else if (message.type === "amiga_mouse_button") {
        host?.setMouseButton(message.button === 3 ? "right" : "left", message.action === "down");
      }
    } catch (error) {
      fail(error);
    }
  });
  window.addEventListener("keydown", (event) => {
    keyInput(event.key, true);
    event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    keyInput(event.key, false);
    event.preventDefault();
  });
  window.addEventListener("blur", clearInputs);
  canvas.addEventListener("pointerdown", () => window.getX68000AudioStream());
  status("Sharp X68000 ready", "Load a game from the room");
  trace("launcher-ready", "WebX68k runtime");
})();
