import { useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Avatar, AvatarImage, AvatarFallback } from '../components/ui/avatar';
import { Card } from '../components/ui/card';
import { Camera, Save, X, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../services/api/client';
import { toast } from 'sonner';

export function Profile() {
  const { user, refreshUser } = useAuth();

  const [profileData, setProfileData] = useState({
    name: '',
    email: '',
    phone: '',
    // Número de WhatsApp do usuário — usado pelo Copiloto IA para reconhecer
    // quem comanda (só números cadastrados comandam a IA). Upgrade RD P3, req 25.
    whatsappNumber: '',
    avatar: null as string | null,
    role: '',
    createdAt: '',
  });

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [stats, setStats] = useState({ leads: 0, automations: 0, memberSince: '', plan: '' });

  useEffect(() => {
    if (user) {
      setProfileData({
        name: user.name || '',
        email: user.email || '',
        phone: (user as any).phone || '',
        whatsappNumber: (user as any).whatsappNumber || '',
        avatar: user.avatar || null,
        role: user.role || '',
        createdAt: (user as any).createdAt || '',
      });
    }
  }, [user]);

  // Load stats
  useEffect(() => {
    const loadStats = async () => {
      try {
        const [leadsRes, automationsRes, subRes] = await Promise.allSettled([
          apiClient.getLeads({ limit: 1 }),
          apiClient.getAutomations({ limit: 1 }),
          apiClient.getCurrentSubscription(),
        ]);
        setStats({
          leads:
            leadsRes.status === 'fulfilled'
              ? leadsRes.value?.pagination?.total || leadsRes.value?.data?.length || 0
              : 0,
          automations:
            automationsRes.status === 'fulfilled'
              ? automationsRes.value?.pagination?.total || automationsRes.value?.data?.length || 0
              : 0,
          memberSince: user?.createdAt
            ? new Date(user.createdAt).toLocaleDateString('pt-BR', {
                month: 'short',
                year: 'numeric',
              })
            : '—',
          plan: subRes.status === 'fulfilled' ? subRes.value?.subscription?.plan?.name || '—' : '—',
        });
      } catch {
        // Stats are non-critical
      }
    };
    if (user) loadStats();
  }, [user]);

  const handleInputChange = (field: string, value: string) => {
    setProfileData((prev) => ({ ...prev, [field]: value }));
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast.error('Por favor, selecione uma imagem válida');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error('A imagem deve ter no máximo 5MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setAvatarPreview(result);
        setProfileData((prev) => ({ ...prev, avatar: result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.updateProfile({
        name: profileData.name,
        phone: profileData.phone,
        avatar: profileData.avatar,
      });
      // O número do WhatsApp usa endpoint próprio (self-service) — persistido em
      // paralelo ao restante do perfil. String vazia limpa o número.
      await apiClient.updateMyWhatsAppNumber(profileData.whatsappNumber.trim() || null);
      if (refreshUser) await refreshUser();
      setAvatarPreview(null);
      setIsEditing(false);
      toast.success('Perfil atualizado com sucesso');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar perfil. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (user) {
      setProfileData({
        name: user.name || '',
        email: user.email || '',
        phone: (user as any).phone || '',
        whatsappNumber: (user as any).whatsappNumber || '',
        avatar: user.avatar || null,
        role: user.role || '',
        createdAt: (user as any).createdAt || '',
      });
    }
    setAvatarPreview(null);
    setIsEditing(false);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="min-h-screen">
      <Header title="Perfil" subtitle="Gerencie suas informações pessoais" />

      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          {/* Profile Header Card */}
          <Card className="bg-card border-gray-300 shadow-sm mb-6">
            <div className="p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="relative">
                  <Avatar className="w-20 h-20 border-2 border-white shadow-md">
                    {profileData.avatar || avatarPreview ? (
                      <AvatarImage
                        src={profileData.avatar || avatarPreview || undefined}
                        alt={profileData.name}
                      />
                    ) : null}
                    <AvatarFallback className="bg-primary text-white text-xl font-semibold">
                      {getInitials(profileData.name || 'U')}
                    </AvatarFallback>
                  </Avatar>
                  {isEditing && (
                    <label
                      htmlFor="avatar-upload"
                      className="absolute bottom-0 right-0 w-7 h-7 bg-primary rounded-full flex items-center justify-center cursor-pointer hover:bg-primary-dark transition-colors shadow-md border-2 border-white"
                    >
                      <Camera size={14} className="text-white" />
                      <input
                        id="avatar-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarChange}
                      />
                    </label>
                  )}
                </div>

                <div className="flex-1">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-1">{profileData.name}</h2>
                  <p className="text-gray-600 mb-2">{profileData.role}</p>
                  <p className="text-sm text-gray-600">{profileData.email}</p>
                </div>

                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <Button variant="outline" onClick={handleCancel} className="gap-2">
                        <X size={16} />
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-primary hover:bg-primary-dark gap-2"
                      >
                        {saving ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Save size={16} />
                        )}
                        Salvar
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => setIsEditing(true)}
                      className="bg-primary hover:bg-primary-dark"
                    >
                      Editar Perfil
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Profile Information */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Personal Information */}
            <Card className="bg-card border-gray-300 shadow-sm">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Informações Pessoais</h3>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="name">Nome completo</Label>
                    <Input
                      id="name"
                      value={profileData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      value={profileData.email}
                      disabled
                      className="mt-1.5 bg-gray-50"
                    />
                    <p className="text-xs text-gray-500 mt-1">O e-mail não pode ser alterado</p>
                  </div>
                  <div>
                    <Label htmlFor="phone">Telefone</Label>
                    <Input
                      id="phone"
                      value={profileData.phone}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="whatsapp-number">Meu número de WhatsApp</Label>
                    <Input
                      id="whatsapp-number"
                      value={profileData.whatsappNumber}
                      onChange={(e) => handleInputChange('whatsappNumber', e.target.value)}
                      disabled={!isEditing}
                      placeholder="+55 11 99999-0000"
                      className="mt-1.5"
                    />
                    <p className="text-xs text-secondary mt-1">
                      Usado pelo Copiloto IA no WhatsApp para reconhecer você. Só quem tem o número
                      cadastrado aqui pode comandar a IA por mensagem.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Account Statistics */}
            <Card className="bg-card border-gray-300 shadow-sm lg:col-span-2">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Estatísticas da Conta</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
                    <span className="text-sm text-gray-600">Leads criados</span>
                    <span className="text-lg font-semibold text-gray-900">{stats.leads}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
                    <span className="text-sm text-gray-600">Automações</span>
                    <span className="text-lg font-semibold text-gray-900">{stats.automations}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
                    <span className="text-sm text-gray-600">Membro desde</span>
                    <span className="text-lg font-semibold text-gray-900">{stats.memberSince}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
                    <span className="text-sm text-gray-600">Plano</span>
                    <span className="text-lg font-semibold text-primary">{stats.plan}</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
