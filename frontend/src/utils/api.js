// Central API configuration.
// For local development: set nothing (falls back to localhost:5000).
// For Railway (or any deployment): set VITE_API_URL in the frontend
// service's environment variables to your backend Railway URL.
//
// Current deployed URLs:
//   Frontend: https://aitr-ftl-lims.up.railway.app
//   Backend:  https://aitr-ftl-backend-lims.up.railway.app

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default API_URL;
