import { useRpc, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch, Text } from "react-native";
import { keepAwake } from "../shared/keep-awake";

export function KeepAwake({ host, theme }: PluginSidebarItemProps) {
  const rpc = useRpc(keepAwake);
  const cache = useQueryClient();
  const queryKey = ["keep-awake", host.id];
  const state = useQuery({ queryKey, queryFn: () => rpc({}), refetchInterval: 5000 });
  const change = useMutation({
    mutationFn: (enabled: boolean) => rpc({ enabled }),
    onSuccess: (data) => { cache.setQueryData(queryKey, data); },
  });
  const enabled = state.data?.enabled ?? false;
  const disabled = !state.data || state.isError || change.isPending;
  return <>
    <SidebarRow
      icon="Coffee"
      label="Keep awake"
      active={enabled}
      onPress={() => { if (!disabled) change.mutate(!enabled); }}
      trailing={<Switch accessibilityLabel="Keep awake even without running agents" value={enabled} disabled={disabled} onValueChange={(value) => change.mutate(value)} />}
    />
    {(state.isError || change.isError) && <Text accessibilityRole="alert" style={{ color: theme.colors.foregroundMuted, paddingHorizontal: 12 }}>Could not update keep awake. Try again.</Text>}
  </>;
}
