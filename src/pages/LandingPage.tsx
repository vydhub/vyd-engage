import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { VYDEcosystemBanner } from '../components/VYDEcosystemBanner';
import {
  Users,
  Zap,
  GitBranch,
  Mail,
  MessageSquare,
  BarChart3,
  CheckCircle,
  Star,
  ArrowRight,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';

function useScrollAnimation() {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

interface PricingPlan {
  name: string;
  price: string;
  features: string[];
  highlighted?: boolean;
}

const fallbackPlans: PricingPlan[] = [
  {
    name: 'Starter',
    price: '97',
    features: [
      'Até 250 leads',
      '1 usuário',
      '5 automações',
      'WhatsApp + E-mail',
      'Suporte por e-mail',
    ],
  },
  {
    name: 'Pro',
    price: '197',
    features: [
      'Até 1.000 leads',
      '5 usuários',
      'Automações ilimitadas',
      'WhatsApp + E-mail',
      'Suporte prioritário',
      'Integrações avançadas',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: '497',
    features: [
      'Leads ilimitados',
      'Usuários ilimitados',
      'Automações ilimitadas',
      'WhatsApp + E-mail + SMS',
      'Suporte 24/7',
      'API customizada',
      'Gerente de conta dedicado',
    ],
  },
];

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>(fallbackPlans);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || '';
    fetch(`${apiUrl}/api/public/plans`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(
        (
          plans: Array<{
            name: string;
            price: number | string;
            features: unknown;
            highlighted?: boolean;
          }>
        ) => {
          if (Array.isArray(plans) && plans.length > 0) {
            setPricingPlans(
              plans.map((p) => ({
                name: p.name,
                price: String(Math.round(Number(p.price))),
                features: Array.isArray(p.features) ? (p.features as string[]) : [],
                highlighted: p.highlighted ?? false,
              }))
            );
          }
        }
      )
      .catch(() => {
        // Keep fallback plans on error
      });
  }, []);

  const heroAnim = useScrollAnimation();
  const featuresAnim = useScrollAnimation();
  const benefitsAnim = useScrollAnimation();
  const testimonialsAnim = useScrollAnimation();
  const pricingAnim = useScrollAnimation();
  const features = [
    {
      icon: Users,
      title: 'Captura Inteligente de Leads',
      description: 'Formulários personalizados e integrações com Meta Ads, Google Ads e mais',
    },
    {
      icon: GitBranch,
      title: 'Pipeline Visual',
      description: 'Organize seus leads em um funil kanban intuitivo e fácil de usar',
    },
    {
      icon: Zap,
      title: 'Automação Poderosa',
      description: 'Configure follow-ups automáticos via WhatsApp e e-mail sem programar',
    },
    {
      icon: BarChart3,
      title: 'Relatórios em Tempo Real',
      description: 'Acompanhe métricas importantes e tome decisões baseadas em dados',
    },
    {
      icon: MessageSquare,
      title: 'WhatsApp Business API',
      description: 'Envie mensagens automatizadas diretamente para o WhatsApp dos seus leads',
    },
    {
      icon: Mail,
      title: 'E-mail Marketing',
      description: 'Crie campanhas de e-mail personalizadas e automatizadas',
    },
  ];

  const testimonials = [
    {
      name: 'Maria Santos',
      role: 'CEO da TechSolutions',
      content:
        'O VYD Engage transformou nossa gestão de leads. Aumentamos nossa conversão em 45% no primeiro mês!',
      rating: 5,
    },
    {
      name: 'João Oliveira',
      role: 'Gerente de Vendas',
      content:
        'A automação via WhatsApp é incrível. Economizamos horas de trabalho manual todos os dias.',
      rating: 5,
    },
    {
      name: 'Ana Costa',
      role: 'Fundadora da StartupX',
      content: 'Interface intuitiva e fácil de usar. Implementamos em menos de 1 hora!',
      rating: 5,
    },
  ];

  const faqs = [
    {
      question: 'Como funciona o período de teste?',
      answer:
        'Você tem 14 dias para testar todas as funcionalidades gratuitamente, sem precisar de cartão de crédito.',
    },
    {
      question: 'Posso cancelar a qualquer momento?',
      answer: 'Sim! Não há fidelidade. Você pode cancelar sua assinatura quando quiser.',
    },
    {
      question: 'Preciso de conhecimento técnico?',
      answer:
        'Não! O VYD Engage foi projetado para ser extremamente intuitivo. Qualquer pessoa consegue usar.',
    },
    {
      question: 'Como funciona a integração com WhatsApp?',
      answer:
        'Usamos a API oficial do WhatsApp Business. Basta conectar sua conta e começar a enviar mensagens automatizadas.',
    },
  ];

  const trustedCompanies = [
    {
      name: 'TechSolutions',
      logo: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=200&h=100&fit=crop',
    },
    {
      name: 'StartupX',
      logo: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=200&h=100&fit=crop',
    },
    {
      name: 'InnovaCorp',
      logo: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=200&h=100&fit=crop',
    },
    {
      name: 'DigitalGrowth',
      logo: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=200&h=100&fit=crop',
    },
    {
      name: 'CloudTech',
      logo: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=200&h=100&fit=crop',
    },
    {
      name: 'SmartBusiness',
      logo: 'https://images.unsplash.com/photo-1556761175-4b46a572b786?w=200&h=100&fit=crop',
    },
    {
      name: 'AgileSolutions',
      logo: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=200&h=100&fit=crop',
    },
    {
      name: 'NextLevel',
      logo: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=200&h=100&fit=crop',
    },
  ];

  return (
    <div className="min-h-screen bg-card">
      {/* VYD Ecosystem Banner */}
      <VYDEcosystemBanner />

      {/* Header */}
      <header className="sticky top-10 left-0 right-0 bg-card/95 backdrop-blur-sm border-b border-gray-300 z-[99]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-white font-bold text-lg">VE</span>
              </div>
              <span className="text-xl font-semibold text-gray-900">VYD Engage</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-gray-600 hover:text-gray-900 transition-colors">
                Funcionalidades
              </a>
              <a href="#pricing" className="text-gray-600 hover:text-gray-900 transition-colors">
                Preços
              </a>
              <a
                href="#testimonials"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                Depoimentos
              </a>
              <a href="#faq" className="text-gray-600 hover:text-gray-900 transition-colors">
                FAQ
              </a>
            </nav>

            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-4">
                <Link to="/login">
                  <Button variant="ghost">Entrar</Button>
                </Link>
                <Link to="/login">
                  <Button className="bg-primary hover:bg-primary-dark">Começar Grátis</Button>
                </Link>
              </div>
              <button
                className="md:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? (
                  <X size={24} className="text-gray-600" />
                ) : (
                  <Menu size={24} className="text-gray-600" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-300 bg-card">
            <nav className="flex flex-col px-6 py-4 gap-4">
              <a
                href="#features"
                className="text-gray-600 hover:text-gray-900 transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                Funcionalidades
              </a>
              <a
                href="#pricing"
                className="text-gray-600 hover:text-gray-900 transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                Preços
              </a>
              <a
                href="#testimonials"
                className="text-gray-600 hover:text-gray-900 transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                Depoimentos
              </a>
              <a
                href="#faq"
                className="text-gray-600 hover:text-gray-900 transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                FAQ
              </a>
              <div className="flex flex-col gap-3 pt-4 border-t border-gray-300">
                <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">
                    Entrar
                  </Button>
                </Link>
                <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full bg-primary hover:bg-primary-dark">
                    Começar Grátis
                  </Button>
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="pt-8 pb-20 px-6">
        <div
          // eslint-disable-next-line react-hooks/refs -- ref do hook useScrollAnimation aplicado ao DOM (uso legítimo do React Compiler para detecção de scroll)
          ref={heroAnim.ref}
          // eslint-disable-next-line react-hooks/refs -- isVisible é estado derivado do IntersectionObserver, não acesso a ref.current
          className={`max-w-7xl mx-auto transition-all duration-700 ${heroAnim.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-gray-900 mb-6">Capture, Organize e Converta Mais Leads</h1>
              <p className="text-xl text-gray-600 mb-8">
                CRM simples e poderoso com automação inteligente via WhatsApp e e-mail. Aumente suas
                vendas sem aumentar sua equipe.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <Link to="/login">
                  <Button size="lg" className="bg-primary hover:bg-primary-dark gap-2">
                    Criar Conta Gratuita
                    <ArrowRight size={20} />
                  </Button>
                </Link>
                <Button size="lg" variant="outline">
                  Assistir Demo
                </Button>
              </div>
              <div className="flex items-center gap-6 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-success" />
                  <span>14 dias grátis</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-success" />
                  <span>Sem cartão de crédito</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-success" />
                  <span>Cancele quando quiser</span>
                </div>
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary-light/20 rounded-2xl transform rotate-3"></div>
              <ImageWithFallback
                src="https://images.unsplash.com/photo-1577563682708-4f022ec774fb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxncm93dGglMjBjaGFydCUyMHN1Y2Nlc3N8ZW58MXx8fHwxNzYzNzc2MzUwfDA&ixlib=rb-4.1.0&q=80&w=1080"
                alt="Dashboard preview"
                className="relative rounded-2xl shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-12 bg-gray-100">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-8">
            <p className="text-gray-600 text-sm font-medium uppercase tracking-wide">
              Empresas que confiam no VYD Engage
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-6 items-center">
            {trustedCompanies.map((company, index) => (
              <div
                key={index}
                className="flex items-center justify-center h-16 px-4 bg-card rounded-lg border border-gray-300 hover:border-primary hover:shadow-sm transition-all grayscale hover:grayscale-0 opacity-70 hover:opacity-100"
                title={company.name}
              >
                <ImageWithFallback
                  src={company.logo}
                  alt={company.name}
                  className="max-h-10 max-w-full object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-6">
        <div
          // eslint-disable-next-line react-hooks/refs -- ref do hook useScrollAnimation aplicado ao DOM (uso legítimo do React Compiler para detecção de scroll)
          ref={featuresAnim.ref}
          // eslint-disable-next-line react-hooks/refs -- isVisible é estado derivado do IntersectionObserver, não acesso a ref.current
          className={`max-w-7xl mx-auto transition-all duration-700 ${featuresAnim.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <div className="text-center mb-16">
            <h2 className="text-gray-900 mb-4">Tudo que você precisa para vender mais</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Ferramentas poderosas para capturar, organizar e converter leads em clientes
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div
                  key={index}
                  className="p-6 rounded-lg border border-gray-300 hover:border-primary hover:shadow-md transition-all"
                >
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                    <Icon className="text-primary" size={24} />
                  </div>
                  <h3 className="text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-gray-600">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 px-6 bg-gray-100">
        <div
          // eslint-disable-next-line react-hooks/refs -- ref do hook useScrollAnimation aplicado ao DOM (uso legítimo do React Compiler para detecção de scroll)
          ref={benefitsAnim.ref}
          // eslint-disable-next-line react-hooks/refs -- isVisible é estado derivado do IntersectionObserver, não acesso a ref.current
          className={`max-w-7xl mx-auto transition-all duration-700 ${benefitsAnim.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <ImageWithFallback
                src="https://images.unsplash.com/photo-1761195696590-3490ea770aa1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhdXRvbWF0aW9uJTIwdGVjaG5vbG9neXxlbnwxfHx8fDE3NjM3NzI0ODR8MA&ixlib=rb-4.1.0&q=80&w=1080"
                alt="Automation"
                className="rounded-2xl shadow-xl"
              />
            </div>
            <div>
              <h2 className="text-gray-900 mb-6">Automação que realmente funciona</h2>
              <p className="text-lg text-gray-600 mb-8">
                Configure fluxos de automação personalizados em minutos, não em dias. Envie
                mensagens no momento certo, para a pessoa certa, pelo canal certo.
              </p>
              <div className="space-y-4">
                {[
                  'Configure em minutos, não em horas',
                  'Sem necessidade de programação',
                  'Personalize com variáveis dinâmicas',
                  'Acompanhe resultados em tempo real',
                ].map((benefit, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <CheckCircle size={20} className="text-success flex-shrink-0" />
                    <span className="text-gray-900">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-20 px-6">
        <div
          // eslint-disable-next-line react-hooks/refs -- ref do hook useScrollAnimation aplicado ao DOM (uso legítimo do React Compiler para detecção de scroll)
          ref={testimonialsAnim.ref}
          // eslint-disable-next-line react-hooks/refs -- isVisible é estado derivado do IntersectionObserver, não acesso a ref.current
          className={`max-w-7xl mx-auto transition-all duration-700 ${testimonialsAnim.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <div className="text-center mb-16">
            <h2 className="text-gray-900 mb-4">O que nossos clientes dizem</h2>
            <p className="text-xl text-gray-600">Mais de 500 empresas já usam o VYD Engage</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="p-6 rounded-lg bg-card border border-gray-300 shadow-sm">
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} size={16} className="fill-amber text-amber" />
                  ))}
                </div>
                <p className="text-gray-900 mb-4">"{testimonial.content}"</p>
                <div>
                  <p className="font-medium text-gray-900">{testimonial.name}</p>
                  <p className="text-sm text-gray-600">{testimonial.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6 bg-gray-100">
        <div
          // eslint-disable-next-line react-hooks/refs -- ref do hook useScrollAnimation aplicado ao DOM (uso legítimo do React Compiler para detecção de scroll)
          ref={pricingAnim.ref}
          // eslint-disable-next-line react-hooks/refs -- isVisible é estado derivado do IntersectionObserver, não acesso a ref.current
          className={`max-w-7xl mx-auto transition-all duration-700 ${pricingAnim.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <div className="text-center mb-16">
            <h2 className="text-gray-900 mb-4">Planos transparentes</h2>
            <p className="text-xl text-gray-600">Escolha o plano ideal para o seu negócio</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {pricingPlans.map((plan, index) => (
              <div
                key={index}
                className={`
                  p-8 rounded-lg bg-card border-2 
                  ${plan.highlighted ? 'border-primary shadow-xl scale-105' : 'border-gray-300'}
                `}
              >
                {plan.highlighted && (
                  <span className="inline-block px-3 py-1 bg-primary text-white text-xs rounded-full mb-4">
                    Mais Popular
                  </span>
                )}
                <h3 className="text-gray-900 mb-2">{plan.name}</h3>
                <div className="mb-6">
                  <span className="text-4xl font-bold text-gray-900">R$ {plan.price}</span>
                  <span className="text-gray-600">/mês</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle size={20} className="text-success flex-shrink-0 mt-0.5" />
                      <span className="text-gray-600">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link to="/login">
                  <Button
                    className={`w-full ${
                      plan.highlighted
                        ? 'bg-primary hover:bg-primary-dark'
                        : 'bg-card border-2 border-primary text-primary hover:bg-primary hover:text-white'
                    }`}
                  >
                    Começar Agora
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-gray-900 mb-4">Perguntas Frequentes</h2>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="rounded-lg bg-card border border-gray-300 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full p-6 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                >
                  <h4 className="text-gray-900 pr-4">{faq.question}</h4>
                  <ChevronDown
                    size={20}
                    className={`text-gray-400 flex-shrink-0 transition-transform duration-200 ${openFaq === index ? 'rotate-180' : ''}`}
                  />
                </button>
                <div
                  className={`overflow-hidden transition-all duration-200 ${openFaq === index ? 'max-h-40 pb-6' : 'max-h-0'}`}
                >
                  <p className="text-gray-600 px-6">{faq.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 bg-gradient-to-r from-primary to-primary-light">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-white mb-6">Pronto para aumentar suas vendas?</h2>
          <p className="text-xl text-white/90 mb-8">
            Junte-se a centenas de empresas que já estão vendendo mais com o VYD Engage
          </p>
          <Link to="/login">
            <Button size="lg" className="bg-card text-primary hover:bg-card/90">
              Começar Agora - É Grátis
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-gray-900">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-white font-bold text-xs">VE</span>
                </div>
                <span className="text-white font-semibold">VYD Engage</span>
              </div>
              <p className="text-gray-400 text-sm">
                O CRM que ajuda você a vender mais, automaticamente.
              </p>
            </div>
            <div>
              <h4 className="text-white font-medium mb-4">Produto</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <a href="#features" className="hover:text-white transition-colors">
                    Funcionalidades
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="hover:text-white transition-colors">
                    Preços
                  </a>
                </li>
                <li>
                  <a href="#faq" className="hover:text-white transition-colors">
                    Perguntas Frequentes
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-medium mb-4">Empresa</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <a href="#testimonials" className="hover:text-white transition-colors">
                    Depoimentos
                  </a>
                </li>
                <li>
                  <a
                    href="mailto:contato@vydengage.com"
                    className="hover:text-white transition-colors"
                  >
                    Contato
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-medium mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <a href="/privacidade" className="hover:text-white transition-colors">
                    Privacidade
                  </a>
                </li>
                <li>
                  <a href="/termos" className="hover:text-white transition-colors">
                    Termos
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-gray-700">
            <p className="text-center text-sm text-gray-400">
              © {new Date().getFullYear()} VYD Engage. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
