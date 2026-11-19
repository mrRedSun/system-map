import type { SystemModel } from '../../shared/model';
import { useApp } from '@/app-context';
import { EntityLink } from '@/components/EntityLink';
import { Empty, Section, Value } from '@/components/Fields';
import { Badge } from '@/components/ui/badge';
import { dnsRecordsFor, hostChain } from '@/lib/model-index';

type Service = SystemModel['services'][number];
type Node = SystemModel['nodes'][number];
type Firewall = NonNullable<Node['firewall']>;

const th = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground';
const td = 'px-2 py-1.5 align-top';

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {head.map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({ children, mono }: { children?: React.ReactNode; mono?: boolean }) {
  return <td className={mono ? `${td} font-mono text-[13px]` : td}>{children ?? '—'}</td>;
}

export function PortsTable({ ports }: { ports: NonNullable<Service['ports']> }) {
  return (
    <Table head={['Port', 'Bind', 'Exposure', 'Auth', 'Purpose']}>
      {ports.map((p, i) => (
        <tr key={i}>
          <Cell mono>
            {p.port}/{p.proto ?? 'tcp'}
          </Cell>
          <Cell mono>{p.bind}</Cell>
          <Cell>{p.exposure && <Badge variant="outline">{p.exposure}</Badge>}</Cell>
          <Cell>{p.auth}</Cell>
          <Cell>{p.purpose}</Cell>
        </tr>
      ))}
    </Table>
  );
}

export function FirewallTable({ firewall }: { firewall: Firewall }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant={firewall.enabled ? 'secondary' : 'destructive'}>
          {firewall.enabled ? 'enabled' : 'disabled'}
        </Badge>
        {firewall.nic_flag !== undefined && (
          <Badge variant="outline">NIC firewall flag {firewall.nic_flag ? 'on' : 'off'}</Badge>
        )}
        {firewall.policy_in && <Badge variant="outline">in: {firewall.policy_in}</Badge>}
        {firewall.policy_out && <Badge variant="outline">out: {firewall.policy_out}</Badge>}
        {firewall.file && <span className="font-mono text-muted-foreground">{firewall.file}</span>}
      </div>
      {firewall.rules && firewall.rules.length > 0 && (
        <Table head={['Action', 'Dir', 'Source', 'Dest', 'Proto/port', 'Comment']}>
          {firewall.rules.map((r, i) => (
            <tr key={i}>
              <Cell>
                <span
                  className={
                    /accept/i.test(r.action ?? '') ? 'text-[var(--health-up)]' : 'text-destructive'
                  }
                >
                  {r.action}
                </span>
              </Cell>
              <Cell>{r.direction}</Cell>
              <Cell mono>{r.source}</Cell>
              <Cell mono>{r.dest}</Cell>
              <Cell mono>
                {[r.proto, r.port].filter((x) => x !== undefined).join('/') || undefined}
              </Cell>
              <Cell>{r.comment}</Cell>
            </tr>
          ))}
        </Table>
      )}
      {firewall.notes && <Value value={firewall.notes} field="notes" />}
    </div>
  );
}

function RoutesTo({ id }: { id: string }) {
  const { model } = useApp();
  const routes = model.routes.filter((r) => r.target === id);
  if (routes.length === 0) return null;
  return (
    <Section title="Public routes">
      <div className="flex flex-col gap-2">
        {routes.map((r) => (
          <RouteCard key={r.id} route={r} />
        ))}
      </div>
    </Section>
  );
}

export function RouteCard({ route }: { route: SystemModel['routes'][number] }) {
  const { model } = useApp();
  const records = dnsRecordsFor(model, route.host);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <EntityLink id={route.id} showIcon={false} className="font-mono font-medium" />
        {route.paths?.map((p) => (
          <span key={p} className="font-mono text-xs text-muted-foreground">
            {p}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="outline">via {route.via}</Badge>
        {route.auth && (
          <Badge variant={route.auth === 'none' ? 'destructive' : 'secondary'}>
            auth: {route.auth}
          </Badge>
        )}
        {route.middlewares?.map((m) => (
          <Badge key={m} variant="outline" className="font-mono">
            {m}
          </Badge>
        ))}
      </div>
      {route.upstream && (
        <div className="font-mono text-xs text-muted-foreground">→ {route.upstream}</div>
      )}
      {records.length > 0 && (
        <div className="font-mono text-xs text-muted-foreground">
          {records.map(({ record }, i) => (
            <div key={i}>
              DNS {record.type} {record.name} → {record.value}
              {record.proxied ? ' (proxied)' : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InheritedFirewalls({ id }: { id: string }) {
  const { index } = useApp();
  const chain = hostChain(index, id);
  const withFirewall = chain.filter(
    (n) => (index.byId.get(n)!.entity as Node).firewall !== undefined,
  );
  if (withFirewall.length === 0) return null;
  return (
    <Section title="Firewall">
      {withFirewall.map((n) => (
        <div key={n} className="flex flex-col gap-1.5">
          {(n !== id || withFirewall.length > 1) && (
            <div className="text-xs text-muted-foreground">
              {n === id ? 'This node' : <EntityLink id={n} />}
            </div>
          )}
          <FirewallTable firewall={(index.byId.get(n)!.entity as Node).firewall!} />
        </div>
      ))}
    </Section>
  );
}

export function NetworkTab({ id }: { id: string }) {
  const { model, index } = useApp();
  const ref = index.byId.get(id);
  if (!ref) return null;

  if (ref.section === 'services') {
    const s = ref.entity as Service;
    return (
      <div className="flex flex-col gap-5">
        {s.ports?.length ? (
          <Section title="Ports">
            <PortsTable ports={s.ports} />
          </Section>
        ) : null}
        {s.urls?.length ? (
          <Section title="URLs">
            <Value value={s.urls} field="urls" />
          </Section>
        ) : null}
        <RoutesTo id={id} />
        {s.calls?.length ? (
          <Section title="Calls">
            <Table head={['Target', 'Via', 'Port', 'Purpose']}>
              {s.calls.map((c, i) => (
                <tr key={i}>
                  <Cell>
                    <Value value={c.target} />
                  </Cell>
                  <Cell>{c.via}</Cell>
                  <Cell mono>{c.port}</Cell>
                  <Cell>{c.purpose}</Cell>
                </tr>
              ))}
            </Table>
          </Section>
        ) : null}
        <InheritedFirewalls id={id} />
      </div>
    );
  }

  if (ref.section === 'nodes') {
    const n = ref.entity as Node;
    const network = model.networks.find((x) => x.id === n.network);
    const services = model.services.filter((s) => s.node === id && s.ports?.length);
    return (
      <div className="flex flex-col gap-5">
        <Section title="Addresses">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            {(
              [
                ['IPs', n.ips],
                ['Hostname', n.hostname],
                ['MAC', n.mac],
              ] as const
            ).map(([k, v]) =>
              v ? (
                <div key={k} className="contents">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd>
                    <Value value={v} />
                  </dd>
                </div>
              ) : null,
            )}
            {network && (
              <div className="contents">
                <dt className="text-xs text-muted-foreground">Network</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <EntityLink id={network.id} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {[network.cidr, network.gateway && `gw ${network.gateway}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </Section>
        {services.length > 0 && (
          <Section title="Listening services">
            <Table head={['Service', 'Ports']}>
              {services.map((s) => (
                <tr key={s.id}>
                  <Cell>
                    <EntityLink id={s.id} />
                  </Cell>
                  <Cell mono>
                    {s.ports!.map((p) => `${p.port}/${p.proto ?? 'tcp'}`).join(', ')}
                  </Cell>
                </tr>
              ))}
            </Table>
          </Section>
        )}
        <InheritedFirewalls id={id} />
      </div>
    );
  }

  if (ref.section === 'routes') {
    return <RouteCard route={ref.entity as SystemModel['routes'][number]} />;
  }
  return <Empty>No network details for a {ref.kind}.</Empty>;
}
