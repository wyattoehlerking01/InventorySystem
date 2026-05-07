function getConfiguredGpioServerBaseUrl() {
    const rawUrl = String(window.APP_ENV?.GPIO_SERVER_URL ?? '').trim();

    if (!rawUrl) return null;

    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

        let normalizedPath = parsed.pathname.replace(/\/+$/, '');
        const endpointSuffixes = ['/unlock', '/hold-open', '/release', '/status'];

        for (const suffix of endpointSuffixes) {
            if (normalizedPath.toLowerCase().endsWith(suffix)) {
                normalizedPath = normalizedPath.slice(0, -suffix.length) || '/';
                break;
            }
        }

        const pathSegment = normalizedPath && normalizedPath !== '/' ? normalizedPath : '';
        return `${parsed.origin}${pathSegment}`;
    } catch {
        return null;
    }
}

function getDoorEndpointUrl(path) {
    const baseUrl = getConfiguredGpioServerBaseUrl();
    if (!baseUrl) return null;

    const normalizedPath = String(path || '/').startsWith('/') ? String(path) : `/${String(path)}`;
    return `${baseUrl}${normalizedPath}`;
}

function getDoorHoldOpenEndpointUrl() {
    const explicitUrl = String(window.APP_ENV?.DOOR_HOLD_OPEN_URL ?? '').trim();
    if (explicitUrl) {
        try {
            const parsed = new URL(explicitUrl, window.location.origin);
            if (parsed.pathname.toLowerCase().endsWith('/holdopen')) {
                parsed.pathname = parsed.pathname.replace(/\/holdopen$/i, '/hold-open');
            }
            return parsed.toString();
        } catch {
            return explicitUrl.replace(/\/holdopen(?:\b|$)/i, '/hold-open');
        }
    }

    return getDoorEndpointUrl('/hold-open') || 'http://127.0.0.1:8090/hold-open';
}