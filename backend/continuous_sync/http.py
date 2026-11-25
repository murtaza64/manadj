"""Fixed-origin bounded native transport. OAuth authority remains with native shell.

The injected httpx client must supply owner authorization; tokens never enter
operation DTOs. This module neither signs in nor turns cloud on.
"""
import json
from urllib.parse import urlsplit
from .service import MAX_PACKET_BYTES, MAX_PAGE_BYTES, SyncFailure, canonical, uuid


class HTTPTransport:
    def __init__(self, client, origin, group_id):
        parsed = urlsplit(origin)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {'', '/'}:
            raise SyncFailure('fixed_cloud_origin_required')
        self.client = client
        self.base = origin.rstrip('/') + '/v1/sync/' + uuid(group_id)

    def _request(self, method, path, **kwargs):
        with self.client.stream(method, self.base + path, follow_redirects=False, timeout=15, **kwargs) as response:
            if response.status_code not in {200, 201}:
                raise SyncFailure('sync_http_' + str(response.status_code))
            raw = bytearray()
            for chunk in response.iter_bytes():
                raw.extend(chunk)
                if len(raw) > MAX_PAGE_BYTES:
                    raise SyncFailure('sync_response_too_large')
            try:
                return json.loads(raw)
            except ValueError as error:
                raise SyncFailure('invalid_sync_response') from error

    def head(self, origin):
        data = self._request('GET', '/origins/' + uuid(origin) + '/head')
        if not isinstance(data, dict) or set(data) != {'sequence'} or type(data['sequence']) is not int or data['sequence'] < 0:
            raise SyncFailure('invalid_remote_head')
        return data['sequence']

    def publish(self, packet, expected):
        b = packet['body']
        data = self._request('PUT', '/origins/' + uuid(b['origin_id']) + '/operations/' + str(b['sequence']),
            content=canonical({'expectedPreviousSequence': expected, 'packet': packet}), headers={'content-type': 'application/json'})
        if data != {'sequence': b['sequence'], 'stored': True}:
            raise SyncFailure('invalid_publish_receipt')

    def read(self, origin, after, limit):
        data = self._request('GET', '/origins/' + uuid(origin) + '/operations', params={'after': after, 'limit': limit})
        if not isinstance(data, dict) or set(data) != {'operations', 'nextAfter', 'more'} or not isinstance(data['operations'], list) or len(data['operations']) > limit:
            raise SyncFailure('invalid_operation_page')
        operations = data['operations']
        expected = after
        for packet in operations:
            if len(canonical(packet)) > MAX_PACKET_BYTES or packet.get('body', {}).get('sequence') != expected + 1:
                raise SyncFailure('invalid_contiguous_page')
            expected += 1
        if type(data['more']) is not bool or type(data['nextAfter']) is not int or data['nextAfter'] != expected or (data['more'] and not operations):
            raise SyncFailure('invalid_page_cursor')
        return operations
