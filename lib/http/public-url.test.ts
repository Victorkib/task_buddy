import { choosePublicAppUrl, isLocalAppUrl, originFromForwarded } from './public-url'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

assert(isLocalAppUrl('http://localhost:3000'), 'localhost is local')
assert(isLocalAppUrl('http://127.0.0.1:3001'), 'loopback is local')
assert(!isLocalAppUrl('https://taskbuddy.example.com'), 'a public host is not local')

assert(originFromForwarded('localhost:3001', null) === 'http://localhost:3001', 'local request keeps its port')
assert(originFromForwarded('taskbuddy.example.com', 'https') === 'https://taskbuddy.example.com', 'forwarded https is kept')
assert(originFromForwarded('evil.example.com/path', 'https') === null, 'a host with a path is rejected')

assert(
  choosePublicAppUrl({
    requestOrigin: 'http://localhost:3001',
    configured: 'https://taskbuddy.example.com',
  }) === 'https://taskbuddy.example.com',
  'a public configured URL is used for email links',
)
assert(
  choosePublicAppUrl({
    requestOrigin: 'http://localhost:3001',
    configured: 'http://localhost:3000',
  }) === 'http://localhost:3001',
  'a localhost configuration uses the site the person opened',
)
assert(
  choosePublicAppUrl({ requestOrigin: null, configured: null }) === 'http://localhost:3000',
  'missing configuration has a local fallback',
)

console.log('public-url tests passed')
