import React, { ReactNode } from 'react';
import Navbar from '../Navbar';
import Footer from '../Footer';
import MobileSidebar from '../MobileSidebar';
import ContactBanner from '../ContactBanner';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/hooks/use-theme';

interface PageLayoutProps {
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
  noFooter?: boolean;
}

const PageLayout: React.FC<PageLayoutProps> = ({ 
  children, 
  className,
  fullWidth = false,
  noFooter = false
}) => {
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen flex flex-col overflow-x-clip max-w-full w-full">
      {!isMobile && <Navbar />}
      
      {/* Nano-textured duotone liquid ambient foundation */}
      <div className="premium-ambient" aria-hidden="true" />
      
      <main 
        className={cn(
          "flex-1 pt-20 md:pt-28 pb-8 md:pb-12 px-3 sm:px-6 lg:px-8 premium-glass-main nano-liquid-frame max-w-full transition-colors duration-200 transform-gpu",
          fullWidth ? "w-full" : "max-w-7xl mx-auto w-full",
          isMobile && "pt-1 px-0 pb-0 rounded-none border-0 bg-transparent shadow-none backdrop-blur-none",
          className
        )}
      >
        <div className="w-full h-full flex flex-col flex-1 relative z-10">
          {children}
        </div>
      </main>
      
      {!isMobile && <ContactBanner />}
      {!isMobile && !noFooter && <Footer />}
      {!isMobile && <MobileSidebar />}
    </div>
  );
};

export default PageLayout;
