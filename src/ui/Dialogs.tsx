import { useApp } from '../app/hooks';
import { CharShapeDialog } from './dialogs/CharShapeDialog';
import { ParaShapeDialog } from './dialogs/ParaShapeDialog';
import { PageSetupDialog, HeaderFooterDialog, PageNumberDialog } from './dialogs/PageDialogs';
import {
  TableDialog,
  LinkDialog,
  SymbolDialog,
  FootnoteDialog,
  GotoDialog,
  CellPropsDialog,
  DocInfoDialog,
  PrefsDialog,
  ShortcutsDialog,
  StyleDialog,
  AboutDialog,
  ConfirmDialog,
  ImageCropDialog,
} from './dialogs/MiscDialogs';

export function Dialogs() {
  const app = useApp();
  const d = app.dialog;
  const close = () => app.closeDialog();
  const needsDoc = d && !['prefs', 'shortcuts', 'about'].includes(d.type);
  let el: JSX.Element | null = null;
  if (d && (!needsDoc || app.active)) {
    switch (d.type) {
      case 'charShape':
        el = <CharShapeDialog onClose={close} />;
        break;
      case 'paraShape':
        el = <ParaShapeDialog onClose={close} />;
        break;
      case 'pageSetup':
        el = <PageSetupDialog onClose={close} />;
        break;
      case 'headerFooter':
        el = <HeaderFooterDialog onClose={close} />;
        break;
      case 'pageNumber':
        el = <PageNumberDialog onClose={close} />;
        break;
      case 'table':
        el = <TableDialog onClose={close} />;
        break;
      case 'link':
        el = <LinkDialog onClose={close} />;
        break;
      case 'symbol':
        el = <SymbolDialog onClose={close} />;
        break;
      case 'footnote':
        el = <FootnoteDialog onClose={close} pos={d.props?.pos ?? null} text={d.props?.text || ''} />;
        break;
      case 'goto':
        el = <GotoDialog onClose={close} />;
        break;
      case 'cellProps':
        el = <CellPropsDialog onClose={close} />;
        break;
      case 'docInfo':
        el = <DocInfoDialog onClose={close} />;
        break;
      case 'prefs':
        el = <PrefsDialog onClose={close} />;
        break;
      case 'shortcuts':
        el = <ShortcutsDialog onClose={close} />;
        break;
      case 'style':
        el = <StyleDialog onClose={close} />;
        break;
      case 'imageCrop':
        el = <ImageCropDialog onClose={close} />;
        break;
      case 'about':
        el = <AboutDialog onClose={close} />;
        break;
    }
  }
  return (
    <>
      {el && <div key={d!.type + JSON.stringify(d!.props || {})}>{el}</div>}
      <ConfirmDialog />
    </>
  );
}
