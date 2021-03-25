import { IDisposable, IEventAggregator } from '@aurelia/kernel';
import { customAttribute, INode, bindable, BindingMode, ViewModelKind, ICustomAttributeViewModel, ICustomAttributeController, CustomAttribute } from '@aurelia/runtime-html';
import { IRouter, RouterNavigationEndEvent } from '../router.js';
import { LoadCustomAttribute } from '../index.js';
import { ILinkHandler } from './link-handler.js';
import { getConsideredActiveInstructions, getLoadIndicator } from './utils.js';

@customAttribute({
  name: 'href',
  noMultiBindings: true
})
export class HrefCustomAttribute implements ICustomAttributeViewModel {
  @bindable({ mode: BindingMode.toView })
  public value: string | undefined;

  public readonly $controller!: ICustomAttributeController<this>;

  private routerNavigationSubscription?: IDisposable;
  private readonly activeClass: string;

  public constructor(
    @INode private readonly element: INode<Element>,
    @IRouter private readonly router: IRouter,
    @ILinkHandler private readonly linkHandler: ILinkHandler,
    @IEventAggregator private readonly ea: IEventAggregator,
  ) {
    this.activeClass = this.router.configuration.options.indicators.loadActive;
  }

  public binding(): void {
    if (this.router.configuration.options.useHref && !this.hasLoad()) {
      this.element.addEventListener('click', this.linkHandler);
      this.routerNavigationSubscription = this.ea.subscribe(RouterNavigationEndEvent.eventName, this.navigationEndHandler);
    }
    this.updateValue();
  }
  public unbinding(): void {
    this.element.removeEventListener('click', this.linkHandler);
    this.routerNavigationSubscription?.dispose();
  }

  public valueChanged(): void {
    this.updateValue();
  }

  private updateValue(): void {
    this.element.setAttribute('href', this.value as string);
  }

  private readonly navigationEndHandler = (_navigation: RouterNavigationEndEvent): void => {
    const controller = CustomAttribute.for(this.element, 'href')!.parent!;
    const instructions = getConsideredActiveInstructions(this.router, controller, this.element as HTMLElement, this.value);
    const element = getLoadIndicator(this.element as HTMLElement);

    element.classList.toggle(this.activeClass, this.router.checkActive(instructions, { context: controller }));
  };

  private hasLoad(): boolean {
    const parent = this.$controller.parent!;
    const siblings = parent.children;
    return siblings?.some(c => c.vmKind === ViewModelKind.customAttribute && c.viewModel instanceof LoadCustomAttribute) ?? false;
  }
}
