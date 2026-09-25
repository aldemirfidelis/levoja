import { useState } from 'react';
import { Image, View } from 'react-native';
import { api, Button, Card, confirm, EmptyState, ErrorView, formatDay, Icon, Loading, radius, Row, Screen, Section, Stack, Text, useApi, useColors, useInvalidate, useToast } from '@levoja/mobile-kit';

interface FleetCompany {
  id: string;
  tradeName: string;
  logoUrl: string | null;
  city: string | null;
}

interface FleetView {
  company: FleetCompany | null;
  invitations: { id: string; message: string | null; expiresAt: string; createdAt: string; company: FleetCompany | null }[];
  rules: string[];
}

function CompanyRow({ company }: { company: FleetCompany }) {
  const colors = useColors();
  return (
    <Row gap={3}>
      {company.logoUrl ? (
        <Image source={{ uri: company.logoUrl }} style={{ width: 48, height: 48, borderRadius: radius.md }} accessibilityIgnoresInvertColors />
      ) : (
        <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="store" size={24} color={colors.brand} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text weight="700">{company.tradeName}</Text>
        {company.city ? (
          <Text variant="caption" tone="muted">
            {company.city}
          </Text>
        ) : null}
      </View>
    </Row>
  );
}

/** Frota própria: empresa atual (com saída) e convites de empresas para aceitar ou recusar. */
export default function FleetScreen() {
  const colors = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const fleet = useApi<FleetView>('drivers/me/fleet');
  const [busy, setBusy] = useState<string | null>(null);

  if (fleet.isLoading) return <Loading />;
  if (fleet.error || !fleet.data) return <ErrorView error={fleet.error} onRetry={() => fleet.refetch()} />;
  const data = fleet.data;

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      await invalidate('drivers/me');
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(null);
    }
  };

  const respond = async (id: string, accept: boolean, name: string) => {
    if (accept && !(await confirm(`Entrar na frota de ${name}?`, data.rules.join('\n\n'), { confirmLabel: 'Aceitar' }))) return;
    await run(id, () => api.post(`drivers/me/fleet/invitations/${id}`, { action: accept ? 'accept' : 'decline' }), accept ? `Agora você faz parte da frota de ${name}.` : 'Convite recusado.');
  };

  const leave = async () => {
    if (!data.company) return;
    if (!(await confirm('Sair da frota própria?', `Você deixa de receber as entregas de ${data.company.tradeName} e volta para a rede da plataforma.`, { confirmLabel: 'Sair', destructive: true }))) return;
    await run('leave', () => api.post('drivers/me/fleet/leave'), 'Você saiu da frota própria.');
  };

  return (
    <Screen refreshing={fleet.isRefetching} onRefresh={() => void fleet.refetch()}>
      {data.company ? (
        <Card>
          <Stack gap={3}>
            <Text variant="caption" tone="muted">
              Você faz parte da frota de
            </Text>
            <CompanyRow company={data.company} />
            <Button title="Sair da frota" variant="secondary" icon="logout" loading={busy === 'leave'} onPress={leave} />
          </Stack>
        </Card>
      ) : (
        <Card>
          <Row gap={3}>
            <Icon name="team" size={28} color={colors.brand} />
            <View style={{ flex: 1 }}>
              <Text weight="700">Você está na rede da plataforma</Text>
              <Text variant="caption" tone="muted">
                Recebe entregas de todas as lojas e clientes da sua região. Empresas podem convidar você para a frota própria delas.
              </Text>
            </View>
          </Row>
        </Card>
      )}

      <Section title="Convites">
        {data.invitations.length === 0 ? (
          <EmptyState icon="team" title="Nenhum convite no momento" description="Quando uma empresa convidar você, o convite aparece aqui e nas notificações." />
        ) : (
          <Stack gap={3}>
            {data.invitations.map((invitation) => (
              <Card key={invitation.id}>
                <Stack gap={3}>
                  {invitation.company ? <CompanyRow company={invitation.company} /> : null}
                  {invitation.message ? <Text>“{invitation.message}”</Text> : null}
                  <Text variant="caption" tone="muted">
                    Válido até {formatDay(invitation.expiresAt)}
                  </Text>
                  <Row gap={2}>
                    <Button title="Recusar" variant="secondary" style={{ flex: 1 }} disabled={!!busy} onPress={() => respond(invitation.id, false, invitation.company?.tradeName ?? 'a empresa')} />
                    <Button title="Aceitar" style={{ flex: 1 }} loading={busy === invitation.id} disabled={!!busy} onPress={() => respond(invitation.id, true, invitation.company?.tradeName ?? 'a empresa')} />
                  </Row>
                </Stack>
              </Card>
            ))}
          </Stack>
        )}
      </Section>

      <Section title="Como funciona a frota própria">
        <Stack gap={2}>
          {data.rules.map((rule) => (
            <Row key={rule} gap={2} align="flex-start">
              <Icon name="info" size={16} color={colors.muted} />
              <Text style={{ flex: 1 }}>{rule}</Text>
            </Row>
          ))}
        </Stack>
      </Section>
    </Screen>
  );
}
