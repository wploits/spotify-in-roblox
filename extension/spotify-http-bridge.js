/**
 * Spicetify Extension: spotify-http-bridge.js
 * Connects to the local HTTP-to-WebSocket bridge server and executes Spotify player/search commands.
 */
(async function SpotifyHttpBridge() {
  const WS_URL = "ws://127.0.0.1:8765/ws";
  const RECONNECT_DELAY_MS = 3000;

  // Wait until Spicetify APIs are ready
  while (!window.Spicetify?.Player || !window.Spicetify?.CosmosAsync) {
    await new Promise((r) => setTimeout(r, 300));
  }

  let ws = null;

  function toHttpImageUrl(url) {
    if (!url) return null;
    if (typeof url === "string" && url.startsWith("spotify:image:")) {
      return "https://i.scdn.co/image/" + url.slice("spotify:image:".length);
    }
    return url;
  }

  function formatTrackItem(item, options = {}) {
    if (!item) return null;
    const { isCurrentTrack = false } = options;
    const meta = item.metadata || {};

    let artists = [];
    if (Array.isArray(item.artists) && item.artists.length > 0) {
      artists = item.artists.map((a) => ({
        name: a.name,
        uri: a.uri || null,
      }));
    } else if (meta.artist_name) {
      artists.push({
        name: meta.artist_name,
        uri: meta.artist_uri || null,
      });
      let i = 1;
      while (meta[`artist_name:${i}`]) {
        artists.push({
          name: meta[`artist_name:${i}`],
          uri: meta[`artist_uri:${i}`] || null,
        });
        i += 1;
      }
    }

    const album = item.album
      ? {
          name: item.album.name,
          uri: item.album.uri || null,
        }
      : meta.album_title || meta.album_uri
      ? {
          name: meta.album_title || null,
          uri: meta.album_uri || null,
        }
      : null;

    const rawImage =
      item.album?.images?.[0]?.url ||
      item.images?.[0]?.url ||
      meta.image_xlarge_url ||
      meta.image_large_url ||
      meta.image_url ||
      meta.image_small_url ||
      null;

    const durationMs =
      item.duration?.milliseconds ??
      (meta.duration != null && meta.duration !== "" ? Number(meta.duration) : null) ??
      (isCurrentTrack ? Spicetify.Player.getDuration() ?? null : null);

    return {
      uri: item.uri,
      name: item.name || meta.title || null,
      artists,
      artistNames: artists.map((a) => a.name).filter(Boolean).join(", "),
      album,
      imageUrl: toHttpImageUrl(rawImage),
      durationMs,
      isLocal: Boolean(
        item.isLocal ||
          meta.is_local === "true" ||
          (item.uri && item.uri.startsWith("spotify:local:"))
      ),
    };
  }

  function getNowPlaying() {
    const data = Spicetify.Player.data || {};
    const item = data.item || null;
    const isPlaying = Spicetify.Player.isPlaying();
    const progressMs = Spicetify.Player.getProgress() ?? 0;
    const durationMs = Spicetify.Player.getDuration() ?? item?.duration?.milliseconds ?? 0;
    const volume = Spicetify.Player.getVolume();

    return {
      isPlaying,
      isPaused: !isPlaying,
      progressMs,
      durationMs,
      volume: typeof volume === "number" ? Math.round(volume * 100) : null,
      shuffle: Boolean(Spicetify.Player.getShuffle()),
      repeat: Spicetify.Player.getRepeat(), // 0: off, 1: context, 2: track
      liked: Boolean(Spicetify.Player.getHeart()),
      track: formatTrackItem(item, { isCurrentTrack: true }),
    };
  }

  async function playUri(uri) {
    if (typeof Spicetify.Player.playUri === "function") {
      await Spicetify.Player.playUri(uri);
      return;
    }
    if (Spicetify.Platform?.PlayerAPI?.play) {
      await Spicetify.Platform.PlayerAPI.play({ uri }, {}, {});
      return;
    }
    throw new Error("No available PlayerAPI.play or playUri method");
  }

  async function addToQueue(uri) {
    if (typeof Spicetify.addToQueue === "function") {
      await Spicetify.addToQueue([{ uri }]);
      return;
    }
    if (Spicetify.Platform?.PlayerAPI?.addToQueue) {
      await Spicetify.Platform.PlayerAPI.addToQueue([{ uri }]);
      return;
    }
    throw new Error("No available addToQueue method");
  }

  function getSpotifyLocale() {
    return Spicetify.Locale?.getLocale?.() || "en";
  }

  async function graphqlAutofillRequest(def, initialVars = {}, context = {}) {
    if (!def || !Spicetify.GraphQL?.Request) {
      throw new Error("GraphQL definition or Request helper unavailable");
    }
    const vars = { ...initialVars };
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        return await Spicetify.GraphQL.Request(def, vars);
      } catch (err) {
        const errors = err?.response?.body?.errors;
        let autoFilled = false;
        if (Array.isArray(errors)) {
          for (const e of errors) {
            const varName = e?.extensions?.name;
            const msg = e?.message || "";
            if (
              e?.extensions?.code === "VALIDATION_INVALID_TYPE_VARIABLE" &&
              varName &&
              !(varName in vars)
            ) {
              if (varName === "locale") {
                vars[varName] = getSpotifyLocale();
              } else if (msg.includes("[")) {
                vars[varName] = Array.isArray(context.uris) ? context.uris : [];
              } else if (msg.includes("Boolean")) {
                vars[varName] = false;
              } else if (msg.includes("Int") || msg.includes("Float")) {
                vars[varName] = 0;
              } else {
                vars[varName] = context.fallbackString ?? "";
              }
              autoFilled = true;
            }
          }
        }
        if (!autoFilled) throw err;
      }
    }
    throw new Error("Exceeded GraphQL variable autofill attempts");
  }

  function extractArtistNames(raw) {
    const direct = raw?.artists?.items;
    const split = [
      ...(raw?.firstArtist?.items || []),
      ...(raw?.otherArtists?.items || []),
    ];
    const list =
      Array.isArray(direct) && direct.length > 0
        ? direct
        : split.length > 0
        ? split
        : Array.isArray(raw?.artists)
        ? raw.artists
        : [];
    return list
      .map((a) => a?.profile?.name || a?.name)
      .filter(Boolean);
  }

  function extractTrackFromGraphQL(raw) {
    const t = raw?.item?.data || raw?.data || raw?.trackUnion || raw?.track || raw;
    if (!t || !t.uri) return null;
    const albumObj = t.albumOfTrack || t.album || null;
    const rawImg =
      albumObj?.coverArt?.sources?.[0]?.url ||
      albumObj?.images?.[0]?.url ||
      t.coverArt?.sources?.[0]?.url ||
      null;
    return {
      uri: t.uri,
      id: t.id || t.uri.split(":").pop(),
      name: t.name || t.title || null,
      artists: extractArtistNames(t),
      album: albumObj?.name || null,
      imageUrl: toHttpImageUrl(rawImg),
      durationMs:
        t.duration?.totalMilliseconds ??
        t.duration?.milliseconds ??
        t.duration_ms ??
        null,
    };
  }

  function extractAlbumFromGraphQL(raw) {
    const a = raw?.item?.data || raw?.data || raw?.albumUnion || raw?.album || raw;
    if (!a || !a.uri) return null;
    return {
      uri: a.uri,
      id: a.id || a.uri.split(":").pop(),
      name: a.name || null,
      artists: extractArtistNames(a),
      imageUrl: toHttpImageUrl(
        a.coverArt?.sources?.[0]?.url || a.images?.[0]?.url || null
      ),
    };
  }

  function extractArtistFromGraphQL(raw) {
    const ar = raw?.item?.data || raw?.data || raw?.artistUnion || raw?.artist || raw;
    if (!ar || !ar.uri) return null;
    return {
      uri: ar.uri,
      id: ar.id || ar.uri.split(":").pop(),
      name: ar.profile?.name || ar.name || null,
      imageUrl: toHttpImageUrl(
        ar.visuals?.avatarImage?.sources?.[0]?.url ||
          ar.images?.[0]?.url ||
          null
      ),
    };
  }

  function extractPlaylistFromGraphQL(raw) {
    const p = raw?.item?.data || raw?.data || raw?.playlistV2 || raw;
    if (!p || !p.uri) return null;
    return {
      uri: p.uri,
      id: p.id || p.uri.split(":").pop(),
      name: p.name || null,
      owner: p.ownerV2?.data?.name || p.owner?.display_name || null,
      imageUrl: toHttpImageUrl(
        p.images?.items?.[0]?.sources?.[0]?.url || p.images?.[0]?.url || null
      ),
    };
  }

  function pushUniqueEntity(list, seen, item) {
    if (!item || !item.uri) return;
    const existingIdx = seen.get(item.uri);
    if (existingIdx == null) {
      seen.set(item.uri, list.length);
      list.push(item);
      return;
    }
    const existing = list[existingIdx];
    list[existingIdx] = {
      ...item,
      ...existing,
      name: existing.name || item.name || null,
      artists:
        Array.isArray(existing.artists) && existing.artists.length > 0
          ? existing.artists
          : item.artists || [],
      album: existing.album || item.album || null,
      owner: existing.owner || item.owner || null,
      imageUrl: existing.imageUrl || item.imageUrl || null,
      durationMs: existing.durationMs ?? item.durationMs ?? null,
    };
  }

  function normalizeGraphQLSearch(searchV2) {
    const out = { tracks: [], albums: [], artists: [], playlists: [] };
    const seen = {
      tracks: new Map(),
      albums: new Map(),
      artists: new Map(),
      playlists: new Map(),
    };

    for (const entry of searchV2?.topResultsV2?.itemsV2 || []) {
      const data = entry?.item?.data || entry?.item || entry;
      const uri = data?.uri;
      if (!uri) continue;
      if (uri.startsWith("spotify:track:")) {
        pushUniqueEntity(out.tracks, seen.tracks, extractTrackFromGraphQL(data));
      } else if (uri.startsWith("spotify:album:")) {
        pushUniqueEntity(out.albums, seen.albums, extractAlbumFromGraphQL(data));
      } else if (uri.startsWith("spotify:artist:")) {
        pushUniqueEntity(out.artists, seen.artists, extractArtistFromGraphQL(data));
      } else if (uri.startsWith("spotify:playlist:")) {
        pushUniqueEntity(
          out.playlists,
          seen.playlists,
          extractPlaylistFromGraphQL(data)
        );
      }
    }

    for (const entry of searchV2?.tracksV2?.items || []) {
      pushUniqueEntity(out.tracks, seen.tracks, extractTrackFromGraphQL(entry));
    }
    for (const entry of searchV2?.albumsV2?.items || []) {
      pushUniqueEntity(out.albums, seen.albums, extractAlbumFromGraphQL(entry));
    }
    for (const entry of searchV2?.artists?.items || []) {
      pushUniqueEntity(out.artists, seen.artists, extractArtistFromGraphQL(entry));
    }
    for (const entry of searchV2?.playlists?.items || []) {
      pushUniqueEntity(
        out.playlists,
        seen.playlists,
        extractPlaylistFromGraphQL(entry)
      );
    }

    return out;
  }

  async function hydrateSearchTracks(tracks, defs) {
    const needsHydration = tracks.filter(
      (t) => !t.name || !Array.isArray(t.artists) || t.artists.length === 0 || !t.album
    );
    if (needsHydration.length === 0) return tracks;

    const byUri = new Map();
    if (defs.decorateContextTracks) {
      try {
        const uris = needsHydration.map((t) => t.uri);
        const res = await graphqlAutofillRequest(
          defs.decorateContextTracks,
          { uris },
          { uris }
        );
        const list =
          res?.data?.tracks ||
          res?.data?.trackUnions ||
          res?.data?.contextTracks ||
          [];
        if (Array.isArray(list)) {
          for (const raw of list) {
            const parsed = extractTrackFromGraphQL(raw);
            if (parsed) byUri.set(parsed.uri, parsed);
          }
        }
      } catch {
        // Fallback to getTrack below
      }
    }

    const stillMissing = needsHydration.filter((t) => {
      const d = byUri.get(t.uri);
      return !d || !d.name || !d.artists?.length || !d.album;
    });

    if (stillMissing.length > 0 && defs.getTrack) {
      const locale = getSpotifyLocale();
      await Promise.all(
        stillMissing.map(async (t) => {
          try {
            const res = await graphqlAutofillRequest(
              defs.getTrack,
              { uri: t.uri, locale },
              { fallbackString: locale }
            );
            const parsed = extractTrackFromGraphQL(res?.data);
            if (parsed) byUri.set(t.uri, parsed);
          } catch {
            // Keep partial item if getTrack fails
          }
        })
      );
    }

    return tracks.map((t) => {
      const h = byUri.get(t.uri);
      if (!h) return t;
      return {
        ...t,
        name: t.name || h.name || null,
        artists: t.artists?.length ? t.artists : h.artists || [],
        album: t.album || h.album || null,
        imageUrl: t.imageUrl || h.imageUrl || null,
        durationMs: t.durationMs ?? h.durationMs ?? null,
      };
    });
  }

  async function hydrateSearchAlbums(albums, defs) {
    const missing = albums.filter((a) => !a.name);
    if (missing.length === 0 || !defs.getAlbum) return albums;

    const locale = getSpotifyLocale();
    const byUri = new Map();
    await Promise.all(
      missing.map(async (a) => {
        try {
          const res = await graphqlAutofillRequest(
            defs.getAlbum,
            { uri: a.uri, locale, offset: 0, limit: 1 },
            { fallbackString: locale }
          );
          const parsed = extractAlbumFromGraphQL(res?.data);
          if (parsed) byUri.set(a.uri, parsed);
        } catch {
          // Keep partial item if getAlbum fails
        }
      })
    );

    return albums.map((a) => {
      const h = byUri.get(a.uri);
      if (!h) return a;
      return {
        ...a,
        name: a.name || h.name || null,
        artists: a.artists?.length ? a.artists : h.artists || [],
        imageUrl: a.imageUrl || h.imageUrl || null,
      };
    });
  }

  async function hydrateSearchArtists(artists, defs) {
    const missing = artists.filter((a) => !a.name || !a.imageUrl);
    if (missing.length === 0) return artists;

    const locale = getSpotifyLocale();
    const byUri = new Map();
    await Promise.all(
      missing.map(async (ar) => {
        let name = ar.name || null;
        let imageUrl = ar.imageUrl || null;
        if (!name && defs.getArtistNameAndTracks) {
          try {
            const res = await graphqlAutofillRequest(
              defs.getArtistNameAndTracks,
              { uri: ar.uri, locale },
              { fallbackString: locale }
            );
            const parsed = extractArtistFromGraphQL(res?.data);
            if (parsed?.name) name = parsed.name;
            if (parsed?.imageUrl && !imageUrl) imageUrl = parsed.imageUrl;
          } catch {
            // Ignore
          }
        }
        if (!imageUrl && defs.fetchExtractedColorAndImageForArtistEntity) {
          try {
            const res = await graphqlAutofillRequest(
              defs.fetchExtractedColorAndImageForArtistEntity,
              { uri: ar.uri },
              { fallbackString: locale }
            );
            const parsed = extractArtistFromGraphQL(res?.data);
            if (parsed?.name && !name) name = parsed.name;
            if (parsed?.imageUrl) imageUrl = parsed.imageUrl;
          } catch {
            // Ignore
          }
        }
        byUri.set(ar.uri, { name, imageUrl });
      })
    );

    return artists.map((ar) => {
      const h = byUri.get(ar.uri);
      if (!h) return ar;
      return {
        ...ar,
        name: ar.name || h.name || null,
        imageUrl: ar.imageUrl || h.imageUrl || null,
      };
    });
  }

  async function searchSpotify({ q, limit = 10 }) {
    if (!q || !String(q).trim()) {
      throw new Error("Query parameter 'q' is required");
    }
    const clampedLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    const defs = Spicetify.GraphQL?.Definitions || {};
    const queryStr = String(q);

    const requests = [];
    if (defs.searchModalResults) {
      requests.push(
        graphqlAutofillRequest(
          defs.searchModalResults,
          {
            searchTerm: queryStr,
            offset: 0,
            limit: clampedLimit,
            numberOfTopResults: Math.max(10, clampedLimit),
            includeAudiobooks: false,
            includeArtistHasConcertsField: false,
            includePreReleases: false,
            includeLocalConcertsField: false,
            includeAuthors: false,
          },
          { fallbackString: queryStr }
        ).catch(() => null)
      );
    }
    if (defs.assistedCurationSearch) {
      requests.push(
        graphqlAutofillRequest(
          defs.assistedCurationSearch,
          {
            term: queryStr,
            offset: 0,
            limit: clampedLimit,
          },
          { fallbackString: queryStr }
        ).catch(() => null)
      );
    }

    const responses = await Promise.all(requests);
    const merged = { tracks: [], albums: [], artists: [], playlists: [] };
    const seen = {
      tracks: new Map(),
      albums: new Map(),
      artists: new Map(),
      playlists: new Map(),
    };

    for (const gqlRes of responses) {
      const searchV2 = gqlRes?.data?.searchV2 || gqlRes?.data?.assistedCurationSearch;
      if (!searchV2) continue;
      const part = normalizeGraphQLSearch(searchV2);
      for (const t of part.tracks) pushUniqueEntity(merged.tracks, seen.tracks, t);
      for (const a of part.albums) pushUniqueEntity(merged.albums, seen.albums, a);
      for (const ar of part.artists) pushUniqueEntity(merged.artists, seen.artists, ar);
      for (const p of part.playlists) pushUniqueEntity(merged.playlists, seen.playlists, p);
    }

    merged.tracks = merged.tracks.slice(0, clampedLimit);
    merged.albums = merged.albums.slice(0, clampedLimit);
    merged.artists = merged.artists.slice(0, clampedLimit);
    merged.playlists = merged.playlists.slice(0, clampedLimit);

    const [tracks, albums, artists] = await Promise.all([
      hydrateSearchTracks(merged.tracks, defs),
      hydrateSearchAlbums(merged.albums, defs),
      hydrateSearchArtists(merged.artists, defs),
    ]);

    const out = {};
    if (tracks.length > 0) out.tracks = tracks;
    if (albums.length > 0) out.albums = albums;
    if (artists.length > 0) out.artists = artists;
    if (merged.playlists.length > 0) out.playlists = merged.playlists;
    return out;
  }

  async function handleCommand(action, params = {}) {
    switch (action) {
      case "status":
      case "now_playing":
        return getNowPlaying();

      case "play": {
        if (params.uri) {
          await playUri(params.uri);
          return { ok: true, uri: params.uri };
        }
        if (params.query || params.q) {
          const q = params.query || params.q;
          const result = await searchSpotify({ q, type: "track", limit: 1 });
          const first = result.tracks?.[0];
          if (!first) {
            throw new Error(`No tracks found for query: ${q}`);
          }
          await playUri(first.uri);
          return { ok: true, matched: first };
        }
        Spicetify.Player.play();
        return { ok: true };
      }

      case "pause":
      case "stop":
        Spicetify.Player.pause();
        return { ok: true };

      case "toggle": {
        const wasPlaying = Spicetify.Player.isPlaying();
        Spicetify.Player.togglePlay();
        return { ok: true, isPlaying: !wasPlaying };
      }

      case "next":
        Spicetify.Player.next();
        return { ok: true };

      case "prev":
      case "back":
        Spicetify.Player.back();
        return { ok: true };

      case "seek": {
        let ms = params.positionMs;
        if (ms == null && params.seconds != null) {
          ms = Number(params.seconds) * 1000;
        }
        if (ms == null || Number.isNaN(Number(ms))) {
          throw new Error("positionMs or seconds is required");
        }
        Spicetify.Player.seek(Math.max(0, Number(ms)));
        return { ok: true, positionMs: Math.max(0, Number(ms)) };
      }

      case "volume": {
        if (params.volume == null) {
          return { volume: Math.round((Spicetify.Player.getVolume() ?? 0) * 100) };
        }
        const v = Number(params.volume);
        if (Number.isNaN(v)) {
          throw new Error("volume must be a number (0-100)");
        }
        let normalized;
        if (v <= 0) {
          normalized = 0;
        } else if (v < 1) {
          normalized = v;
        } else {
          normalized = Math.min(100, v) / 100;
        }
        Spicetify.Player.setVolume(normalized);
        return { ok: true, volume: Math.round(normalized * 100) };
      }

      case "shuffle": {
        const nextState =
          params.state != null ? Boolean(params.state) : !Spicetify.Player.getShuffle();
        Spicetify.Player.setShuffle(nextState);
        return { ok: true, shuffle: nextState };
      }

      case "repeat": {
        let mode = params.mode;
        if (mode == null) {
          mode = (Spicetify.Player.getRepeat() + 1) % 3;
        } else {
          mode = Number(mode);
        }
        if (![0, 1, 2].includes(mode)) {
          throw new Error("repeat mode must be 0 (off), 1 (context), or 2 (track)");
        }
        Spicetify.Player.setRepeat(mode);
        return { ok: true, repeat: mode };
      }

      case "like": {
        const current = Boolean(Spicetify.Player.getHeart());
        const target = params.liked == null ? !current : Boolean(params.liked);
        if (target !== current) {
          Spicetify.Player.toggleHeart();
        }
        return { ok: true, liked: target };
      }

      case "queue_get": {
        const q = Spicetify.Queue || {};
        return {
          track: formatTrackItem(Spicetify.Player.data?.item || q.track?.contextTrack, {
            isCurrentTrack: true,
          }),
          nextTracks: (q.nextTracks || [])
            .map((t) => t.contextTrack || t)
            .filter((t) => t && t.uri && t.uri !== "spotify:delimiter")
            .slice(0, 20)
            .map((t) => formatTrackItem(t)),
        };
      }

      case "queue_add": {
        let uri = params.uri;
        let matched = null;
        if (!uri && (params.query || params.q)) {
          const q = params.query || params.q;
          const result = await searchSpotify({ q, type: "track", limit: 1 });
          const first = result.tracks?.[0];
          if (!first) {
            throw new Error(`No tracks found for query: ${q}`);
          }
          uri = first.uri;
          matched = first;
        }
        if (!uri) {
          throw new Error("uri or query is required");
        }
        await addToQueue(uri);
        return matched ? { ok: true, uri, matched } : { ok: true, uri };
      }

      case "search":
        return await searchSpotify(params);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  function sendJson(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function connect() {
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      setTimeout(connect, RECONNECT_DELAY_MS);
      return;
    }

    ws.addEventListener("open", () => {
      console.log("[HTTP Bridge] Connected to", WS_URL);
      sendJson({ type: "hello", status: getNowPlaying() });
    });

    ws.addEventListener("message", async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      const { id, action, params } = msg;
      if (!id || !action) return;

      try {
        const result = await handleCommand(action, params);
        sendJson({ id, ok: true, data: result });
      } catch (err) {
        sendJson({
          id,
          ok: false,
          error: err?.message || String(err),
        });
      }
    });

    ws.addEventListener("close", () => {
      ws = null;
      setTimeout(connect, RECONNECT_DELAY_MS);
    });

    ws.addEventListener("error", () => {
      if (ws) ws.close();
    });
  }

  // Push state updates when song or play/pause changes
  Spicetify.Player.addEventListener("songchange", () => {
    sendJson({ type: "event", event: "songchange", status: getNowPlaying() });
  });
  Spicetify.Player.addEventListener("onplaypause", () => {
    sendJson({ type: "event", event: "onplaypause", status: getNowPlaying() });
  });

  connect();
})();
