"""Managed local shell bridge for the real continuous ORM replica.

No network, enrollment, private keys or bearer tokens cross this boundary.
Installed only in the token-authenticated managed backend, never LAN listener.
"""
import hmac
import json
from ipaddress import ip_address

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from starlette.concurrency import run_in_threadpool

from backend.peer_sync.models import GroupMember
from .models import Cursor, Operation
from .service import Replica, SyncFailure, canonical, uuid


PATH = '/api/_shell/continuous-sync'


def install(app, token, sessions):
    if not token:
        return

    def action(body):
        if not isinstance(body, dict) or set(body) - {'group', 'action', 'origin', 'after', 'packet'}:
            raise SyncFailure('invalid_shell_sync_request')
        group = uuid(body.get('group'))
        verb = body.get('action')
        with sessions() as db:
            replica = Replica(db, group)
            if verb == 'capture':
                replica.capture(limit=4)
                return {'captured': True}
            if verb == 'receive':
                return replica.receive(body.get('packet'))
            local, _ = replica._local()
            members = list(db.scalars(select(GroupMember).where(GroupMember.group_id == group, GroupMember.revoked == 0)))
            origins = sorted(member.device_id for member in members)
            if not 2 <= len(origins) <= 3:
                raise SyncFailure('bounded_pinned_group_required')
            if verb == 'plan':
                cursors = {origin: (db.get(Cursor, (group, origin)).sequence if db.get(Cursor, (group, origin)) else 0) for origin in origins}
                latest = db.scalar(select(func.max(Operation.sequence)).where(Operation.group_id == group, Operation.origin_id == local.device_id)) or 0
                return {'local': local.device_id, 'origins': origins, 'cursors': cursors, 'latest': latest}
            if verb == 'packets':
                if body.get('origin') != local.device_id or type(body.get('after')) is not int or body['after'] < 0:
                    raise SyncFailure('invalid_own_packet_request')
                # At most one large operation per IPC response. Never truncate.
                return {'packets': replica.packets(local.device_id, after=body['after'], limit=1)}
            raise SyncFailure('invalid_shell_sync_action')

    async def route(request):
        try:
            peer = ip_address(request.client.host) if request.client else None
        except ValueError:
            peer = None
        if (peer is None or not peer.is_loopback or request.headers.get('origin') is not None
            or any(h in request.headers for h in ('forwarded', 'x-forwarded-for', 'x-real-ip'))
            or not hmac.compare_digest(request.headers.get('x-manadj-shell-token', ''), token)):
            raise HTTPException(403, 'Managed shell authorization required')
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 256 * 1024:
                raise HTTPException(413, 'Bounded sync request required')
        try:
            body = json.loads(raw)
            result = await run_in_threadpool(action, body)
            if len(canonical(result)) > 256 * 1024:
                raise SyncFailure('bounded_shell_response_required')
        except (ValueError, TypeError, KeyError):
            return JSONResponse({'error': 'shell_sync_rejected'}, status_code=409)
        return JSONResponse(result, headers={'Cache-Control': 'no-store'})

    # Explicit Request annotation, FastAPI must not interpret it as a query arg.
    from fastapi import Request
    route.__annotations__['request'] = Request
    app.add_api_route(PATH, route, methods=['POST'], include_in_schema=False)
