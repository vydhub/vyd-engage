import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import { LoadingButton } from '../components/ui/loading-button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import {
  UserPlus,
  Edit2,
  XCircle,
  UsersRound,
  Mail,
  ShieldAlert,
  RefreshCw,
  Users2,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../services/api/client';
import {
  COMMERCIAL_FUNCTIONS,
  COMMERCIAL_FUNCTION_LABELS,
  type CommercialFunction,
} from '@/types/comercial';
import { TeamsTab } from '../components/settings/teams/TeamsTab';
import { PermissionsTab } from '../components/settings/permissions/PermissionsTab';
import type { Team, PermissionProfile } from '../types/governance';

// Radix Select proíbe SelectItem com value="". Sentinels para "sem equipe/perfil".
const NO_TEAM = '__none__';
const NO_PROFILE = '__none__';

// Radix Select proíbe SelectItem com value="". Usamos um sentinel para "Sem função"
// e mapeamos de/para string vazia no estado.
const NO_COMMERCIAL_FUNCTION = '__none__';

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  commercialFunction: CommercialFunction | null;
  createdAt: string;
  lastLoginAt: string | null;
  // Times & governança (Upgrade RD P1): vínculos opcionais. Podem não vir do
  // GET /users legado — nesse caso a edição parte de "sem vínculo".
  teamId?: string | null;
  permissionProfileId?: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  status: string;
}

function RoleBadge({ role }: { role: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    ADMIN: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Admin' },
    USER: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Usuário' },
    VIEWER: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Visualizador' },
  };
  const c = config[role] || config.USER;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === 'ACTIVE';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {isActive ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <>
      {[1, 2, 3].map((row) => (
        <TableRow key={row}>
          {Array.from({ length: columns }).map((_, col) => (
            <TableCell key={col}>
              <Skeleton className="h-4 w-24" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function TeamManagement() {
  const { user } = useAuth();

  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingInvitations, setLoadingInvitations] = useState(true);

  // Edit user modal
  const [editingUser, setEditingUser] = useState<TeamUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editStatus, setEditStatus] = useState(false);
  const [editCommercialFunction, setEditCommercialFunction] = useState('');
  const [editTeamId, setEditTeamId] = useState('');
  const [editPermissionProfileId, setEditPermissionProfileId] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  // Times & perfis — para os selects do modal e para a aba Equipes.
  const [teams, setTeams] = useState<Team[]>([]);
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('USER');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Cancel invitation confirmation
  const [cancellingInvitation, setCancellingInvitation] = useState<Invitation | null>(null);

  // Resend invitation
  const [resendingId, setResendingId] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';
  // GESTOR também acessa a Gestão de Equipe, mas só para definir a Função comercial;
  // papel/status seguem restritos a ADMIN (o backend impõe o mesmo em users.ts).
  const isManager = user?.role === 'ADMIN' || user?.role === 'GESTOR';

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await apiClient.getUsers();
      // Contas de CONSULTOR (portal do parceiro) são geridas pelo módulo de
      // Parceiros — não aparecem na gestão de equipe interna.
      setUsers((data as TeamUser[]).filter((u) => u.role !== 'CONSULTOR'));
    } catch (error: any) {
      toast.error(error.message || 'Erro ao carregar membros da equipe');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    setLoadingInvitations(true);
    try {
      const data = await apiClient.getInvitations();
      setInvitations(data);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao carregar convites');
    } finally {
      setLoadingInvitations(false);
    }
  }, []);

  // Equipes/perfis alimentam os selects do modal de editar usuário e a lista da
  // aba Equipes. Falha silenciosa: o modal continua funcional só com função/papel.
  const fetchTeamsAndProfiles = useCallback(async () => {
    try {
      const [teamsRes, profilesRes] = await Promise.all([
        apiClient.getTeams(),
        apiClient.getPermissionProfiles(),
      ]);
      setTeams(teamsRes.data);
      setProfiles(profilesRes.data);
    } catch {
      // Ignora: selects de equipe/perfil ficam vazios; o resto do modal segue.
    }
  }, []);

  useEffect(() => {
    // GESTOR carrega os membros (para definir função comercial); convites seguem ADMIN.
    if (isManager) {
      fetchUsers();
      fetchTeamsAndProfiles();
    }
    if (isAdmin) fetchInvitations();
  }, [isManager, isAdmin, fetchUsers, fetchInvitations, fetchTeamsAndProfiles]);

  const handleOpenEditModal = (teamUser: TeamUser) => {
    setEditingUser(teamUser);
    setEditName(teamUser.name || '');
    setEditEmail(teamUser.email || '');
    setEditRole(teamUser.role);
    setEditStatus(teamUser.status === 'ACTIVE');
    setEditCommercialFunction(teamUser.commercialFunction || '');
    setEditTeamId(teamUser.teamId || '');
    setEditPermissionProfileId(teamUser.permissionProfileId || '');
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;
    setSavingUser(true);
    try {
      const newStatus = editStatus ? 'ACTIVE' : 'INACTIVE';
      await apiClient.updateUser(editingUser.id, {
        // Nome: ADMIN/GESTOR. E-mail: só ADMIN (o backend ignora de não-admin).
        name: editName.trim(),
        ...(isAdmin ? { email: editEmail.trim() } : {}),
        role: editRole,
        status: newStatus,
        commercialFunction: editCommercialFunction || null,
        teamId: editTeamId || null,
        permissionProfileId: editPermissionProfileId || null,
      });
      toast.success('Membro atualizado com sucesso');
      setEditingUser(null);
      fetchUsers();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao atualizar membro');
    } finally {
      setSavingUser(false);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error('Informe o email do convidado');
      return;
    }
    setSendingInvite(true);
    try {
      const result = await apiClient.createInvitation({
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteRole('USER');
      fetchInvitations();
      if (result.emailSent === false) {
        toast.warning('Convite criado, mas o email não foi enviado', {
          description: 'O serviço de email não está configurado. Copie o link e envie manualmente.',
          action: result.invitationLink
            ? {
                label: 'Copiar link',
                onClick: () => navigator.clipboard.writeText(result.invitationLink!),
              }
            : undefined,
          duration: 15000,
        });
      } else {
        toast.success('Convite enviado com sucesso');
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro ao enviar convite');
    } finally {
      setSendingInvite(false);
    }
  };

  const handleResendInvitation = async (id: string) => {
    setResendingId(id);
    try {
      const result = await apiClient.resendInvitation(id);
      if (result.emailSent) {
        toast.success('Convite reenviado com sucesso');
      } else {
        toast.warning('Email não pôde ser enviado', {
          description: 'O serviço de email não está configurado. Copie o link e envie manualmente.',
          action: result.invitationLink
            ? {
                label: 'Copiar link',
                onClick: () => navigator.clipboard.writeText(result.invitationLink!),
              }
            : undefined,
          duration: 15000,
        });
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro ao reenviar convite');
    } finally {
      setResendingId(null);
    }
  };

  const handleCancelInvitation = async () => {
    if (!cancellingInvitation) return;
    try {
      await apiClient.cancelInvitation(cancellingInvitation.id);
      toast.success('Convite cancelado com sucesso');
      setCancellingInvitation(null);
      fetchInvitations();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao cancelar convite');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Access control: non-admin users see a forbidden state
  if (!isManager) {
    return (
      <div className="min-h-screen">
        <Header title="Equipe" subtitle="Gerenciamento de membros e convites" />
        <div className="p-8">
          <div className="bg-card rounded-lg shadow-sm border border-gray-300">
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ShieldAlert size={48} className="text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Acesso restrito</h3>
              <p className="text-sm text-gray-600 max-w-md">
                Apenas administradores podem gerenciar membros da equipe e convites.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Equipe" subtitle="Gerencie membros e convites da sua equipe" />

      <div className="p-8">
        <div className="bg-card rounded-lg shadow-sm border border-gray-300">
          {/* Top bar with invite button */}
          <div className="p-6 border-b border-gray-300">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Gerenciamento de Equipe</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Gerencie os membros da sua equipe e envie convites para novos colaboradores
                </p>
              </div>
              <Button
                onClick={() => setShowInviteModal(true)}
                className="bg-primary hover:bg-primary-dark"
              >
                <UserPlus size={16} className="mr-2" />
                Convidar Membro
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="p-6">
            <Tabs defaultValue="members">
              <TabsList>
                <TabsTrigger value="members">
                  <UsersRound size={16} className="mr-1.5" />
                  Membros
                </TabsTrigger>
                <TabsTrigger value="invitations">
                  <Mail size={16} className="mr-1.5" />
                  Convites
                </TabsTrigger>
                <TabsTrigger value="teams">
                  <Users2 size={16} className="mr-1.5" />
                  Equipes
                </TabsTrigger>
                <TabsTrigger value="permissions">
                  <ShieldCheck size={16} className="mr-1.5" />
                  Perfis
                </TabsTrigger>
              </TabsList>

              {/* Members Tab */}
              <TabsContent value="members" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Papel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingUsers ? (
                      <TableSkeleton columns={5} />
                    ) : users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <div className="text-center py-12">
                            <UsersRound size={40} className="mx-auto text-gray-400 mb-3" />
                            <p className="text-gray-600">Nenhum membro encontrado</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((teamUser) => (
                        <TableRow key={teamUser.id}>
                          <TableCell className="font-medium text-gray-900">
                            {teamUser.name}
                          </TableCell>
                          <TableCell className="text-gray-600">{teamUser.email}</TableCell>
                          <TableCell>
                            <RoleBadge role={teamUser.role} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={teamUser.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <button
                              onClick={() => handleOpenEditModal(teamUser)}
                              className="p-2 hover:bg-gray-100 rounded transition-colors"
                              aria-label={`Editar ${teamUser.name}`}
                              title="Editar membro"
                            >
                              <Edit2 size={16} className="text-gray-600" />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* Invitations Tab */}
              <TabsContent value="invitations" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Papel</TableHead>
                      <TableHead>Enviado em</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingInvitations ? (
                      <TableSkeleton columns={4} />
                    ) : invitations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <div className="text-center py-12">
                            <Mail size={40} className="mx-auto text-gray-400 mb-3" />
                            <p className="text-gray-600">Nenhum convite pendente</p>
                            <p className="text-sm text-gray-500 mt-1">
                              Envie um convite para adicionar novos membros à equipe
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      invitations.map((invitation) => (
                        <TableRow key={invitation.id}>
                          <TableCell className="font-medium text-gray-900">
                            {invitation.email}
                          </TableCell>
                          <TableCell>
                            <RoleBadge role={invitation.role} />
                          </TableCell>
                          <TableCell className="text-gray-600">
                            {formatDate(invitation.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex gap-1">
                              <button
                                onClick={() => handleResendInvitation(invitation.id)}
                                disabled={resendingId === invitation.id}
                                className="p-2 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                                aria-label={`Reenviar convite para ${invitation.email}`}
                                title="Reenviar convite"
                              >
                                <RefreshCw
                                  size={16}
                                  className={`text-blue-600 ${resendingId === invitation.id ? 'animate-spin' : ''}`}
                                />
                              </button>
                              <button
                                onClick={() => setCancellingInvitation(invitation)}
                                className="p-2 hover:bg-red-50 rounded transition-colors"
                                aria-label={`Cancelar convite para ${invitation.email}`}
                                title="Cancelar convite"
                              >
                                <XCircle size={16} className="text-red-600" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* Teams Tab (Upgrade RD P1, req 12) */}
              <TabsContent value="teams" className="mt-4">
                <TeamsTab users={users} loadingUsers={loadingUsers} />
              </TabsContent>

              {/* Permissions Profiles Tab (Upgrade RD P1, reqs 13/14) */}
              <TabsContent value="permissions" className="mt-4">
                <PermissionsTab />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Edit User Modal */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Membro</DialogTitle>
            <DialogDescription>Altere os dados, o papel e o status de {editingUser?.name}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nome do membro"
              />
            </div>

            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                disabled={!isAdmin}
                placeholder="email@empresa.com"
              />
              {!isAdmin && (
                <p className="text-xs text-muted-foreground">
                  Apenas administradores podem alterar o e-mail (identidade de login).
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={editRole} onValueChange={setEditRole} disabled={!isAdmin}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o papel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="GESTOR">Gestor</SelectItem>
                  <SelectItem value="USER">Usuário</SelectItem>
                  <SelectItem value="VIEWER">Visualizador</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Função comercial</Label>
              <Select
                value={editCommercialFunction || NO_COMMERCIAL_FUNCTION}
                onValueChange={(value) =>
                  setEditCommercialFunction(value === NO_COMMERCIAL_FUNCTION ? '' : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a função comercial" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COMMERCIAL_FUNCTION}>Sem função</SelectItem>
                  {COMMERCIAL_FUNCTIONS.map((fn) => (
                    <SelectItem key={fn} value={fn}>
                      {COMMERCIAL_FUNCTION_LABELS[fn]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Times & governança (Upgrade RD P1): vínculo com equipe e perfil. */}
            <div className="space-y-2">
              <Label>Equipe</Label>
              <Select
                value={editTeamId || NO_TEAM}
                onValueChange={(value) => setEditTeamId(value === NO_TEAM ? '' : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a equipe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEAM}>Sem equipe</SelectItem>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Perfil de permissão</Label>
              <Select
                value={editPermissionProfileId || NO_PROFILE}
                onValueChange={(value) =>
                  setEditPermissionProfileId(value === NO_PROFILE ? '' : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o perfil" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROFILE}>Padrão do papel</SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Status</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {editStatus ? 'Ativo' : 'Inativo'}
                </p>
              </div>
              <Switch checked={editStatus} onCheckedChange={setEditStatus} disabled={!isAdmin} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancelar
            </Button>
            <LoadingButton
              loading={savingUser}
              loadingText="Salvando..."
              onClick={handleSaveUser}
              className="bg-primary hover:bg-primary-dark"
            >
              Salvar
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar Membro</DialogTitle>
            <DialogDescription>
              Envie um convite por email para adicionar um novo membro à equipe
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="email@exemplo.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o papel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="GESTOR">Gestor</SelectItem>
                  <SelectItem value="USER">Usuário</SelectItem>
                  <SelectItem value="VIEWER">Visualizador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>
              Cancelar
            </Button>
            <LoadingButton
              loading={sendingInvite}
              loadingText="Enviando..."
              onClick={handleSendInvite}
              className="bg-primary hover:bg-primary-dark"
            >
              <UserPlus size={16} className="mr-2" />
              Enviar Convite
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Invitation Confirmation */}
      <AlertDialog
        open={!!cancellingInvitation}
        onOpenChange={(open) => !open && setCancellingInvitation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar convite</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja cancelar o convite para{' '}
              <strong>{cancellingInvitation?.email}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelInvitation}
              className="bg-red-600 hover:bg-red-700"
            >
              Cancelar Convite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
