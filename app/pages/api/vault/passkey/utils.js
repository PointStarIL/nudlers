export const getRpID = (req) => {
    if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = forwardedHost ? forwardedHost.toString().split(',')[0].trim() : (req.headers.host || 'localhost');
    return host.split(':')[0];
};

export const getOrigin = (req) => {
    if (process.env.WEBAUTHN_ORIGIN) return process.env.WEBAUTHN_ORIGIN;
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = forwardedProto ? forwardedProto.toString().split(',')[0].trim() : 'http';
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = forwardedHost ? forwardedHost.toString().split(',')[0].trim() : (req.headers.host || 'localhost:6969');
    return `${protocol}://${host}`;
};
