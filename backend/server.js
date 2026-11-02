import { createOrganizerServer } from './sync.js';

const port = process.env.PORT || 3000;
createOrganizerServer().listen(port, () => console.log(`Chaos API: http://localhost:${port}`));
