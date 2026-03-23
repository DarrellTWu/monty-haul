# Server Package
Colyseus authoritative game server.
All game logic is imported from shared/logic/ — never write balance data or
combat math directly in server files.
Server systems in systems/ are wrappers that call shared/logic functions
in a multiplayer context.
All tuning values come from shared/data/.