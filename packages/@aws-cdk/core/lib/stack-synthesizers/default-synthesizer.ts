import * as cxapi from '@aws-cdk/cx-api';
import { DockerImageAssetLocation, DockerImageAssetSource, FileAssetLocation, FileAssetSource } from '../assets';
import { Fn } from '../cfn-fn';
import { CfnParameter } from '../cfn-parameter';
import { CfnRule } from '../cfn-rule';
import { Stack } from '../stack';
import { Token } from '../token';
import { AssetManifestBuilder } from './_asset-manifest-builder';
import { assertBound, StringSpecializer, stackTemplateFileAsset } from './_shared';
import { StackSynthesizer } from './stack-synthesizer';
import { ISynthesisSession } from './types';

export const BOOTSTRAP_QUALIFIER_CONTEXT = '@aws-cdk/core:bootstrapQualifier';

/* eslint-disable max-len */

/**
 * The minimum bootstrap stack version required by this app.
 */
const MIN_BOOTSTRAP_STACK_VERSION = 6;

/**
 * The minimum bootstrap stack version required
 * to use the lookup role.
 */
const MIN_LOOKUP_ROLE_BOOTSTRAP_STACK_VERSION = 8;

/**
 * Configuration properties for DefaultStackSynthesizer
 */
export interface DefaultStackSynthesizerProps {
  /**
   * Name of the S3 bucket to hold file assets
   *
   * You must supply this if you have given a non-standard name to the staging bucket.
   *
   * The placeholders `${Qualifier}`, `${AWS::AccountId}` and `${AWS::Region}` will
   * be replaced with the values of qualifier and the stack's account and region,
   * respectively.
   *
   * @default DefaultStackSynthesizer.DEFAULT_FILE_ASSETS_BUCKET_NAME
   */
  readonly fileAssetsBucketName?: string;

  /**
   * Name of the ECR repository to hold Docker Image assets
   *
   * You must supply this if you have given a non-standard name to the ECR repository.
   *
   * The placeholders `${Qualifier}`, `${AWS::AccountId}` and `${AWS::Region}` will
   * be replaced with the values of qualifier and the stack's account and region,
   * respectively.
   *
   * @default DefaultStackSynthesizer.DEFAULT_IMAGE_ASSETS_REPOSITORY_NAME
   */
  readonly imageAssetsRepositoryName?: string;

  /**
   * The role to use to publish file assets to the S3 bucket in this environment
   *
   * You must supply this if you have given a non-standard name to the publishing role.
   *
   * The placeholders `${Qualifier}`, `${AWS::AccountId}` and `${AWS::Region}` will
   * be replaced with the values of qualifier and the stack's account and region,
   * respectively.
   *
   * @default DefaultStackSynthesizer.DEFAULT_FILE_ASSET_PUBLISHING_ROLE_ARN
   */
  readonly fileAssetPublishingRoleArn?: string;

  /**
   * External ID to use when assuming role for file asset publishing
   *
   * @default - No external ID
   */
  readonly fileAssetPublishingExternalId?: string;

  /**
   * The role to use to publish image assets to the ECR repository in this environment
   *
   * You must supply this if you have given a non-standard name to the publishing role.
   *
   * The placeholders `${Qualifier}`, `${AWS::AccountId}` and `${AWS::Region}` will
   * be replaced with the values of qualifier and the stack's account and region,
   * respectively.
   *
   * @default DefaultStackSynthesizer.DEFAULT_IMAGE_ASSET_PUBLISHING_ROLE_ARN
   */
  readonly imageAssetPublishingRoleArn?: string;

  /**
   * The role to use to look up values from the target AWS account during synthesis
   *
   * @default - None
   */
  readonly lookupRoleArn?: string;

  /**
   * External ID to use when assuming lookup role
   *
   * @default - No external ID
   */
  readonly lookupRoleExternalId?: string;

  /**
   * Use the bootstrapped lookup role for (read-only) stack operations
   *
   * Use the lookup role when performing a `cdk diff`. If set to `false`, the
   * `deploy role` credentials will be used to perform a `cdk diff`.
   *
   * Requires bootstrap stack version 8.
   *
   * @default true
   */
  readonly useLookupRoleForStackOperations?: boolean;

  /**
   * External ID to use when assuming role for image asset publishing
   *
   * @default - No external ID
   */
  readonly imageAssetPublishingExternalId?: string;

  /**
   * External ID to use when assuming role for cloudformation deployments
   *
   * @default - No external ID
   */
  readonly deployRoleExternalId?: string;

  /**
   * The role to assume to initiate a deployment in this environment
   *
   * You must supply this if you have given a non-standard name to the publishing role.
   *
   * The placeholders `${Qualifier}`, `${AWS::AccountId}` and `${AWS::Region}` will
   * be replaced with the values of qualifier and the stack's account and region,
   * respectively.
   *
   * @default DefaultStackSynthesizer.DEFAULT_DEPLOY_ROLE_ARN
   */
  readonly deployRoleArn?: string;

  /**
   * The role CloudFormation will assume when deploying the Stack
   *
   * You must supply this if you have given a non-standard name to the execution role.
   *
   * The placeholders `${Qualifier}`, `${AWS::AccountId}` and `${AWS::Region}` will
   * be replaced with the values of qualifier and the stack's account and region,
   * respectively.
   *
   * @default DefaultStackSynthesizer.DEFAULT_CLOUDFORMATION_ROLE_ARN
   */
  readonly cloudFormationExecutionRole?: string;

  /**
   * Name of the CloudFormation Export with the asset key name
   *
   * You must supply this if you have given a non-standard name to the KMS key export
   *
   * The placeholders `${Qualifier}`, `${AWS::AccountId}` and `${AWS::Region}` will
   * be replaced with the values of qualifier and the stack's account and region,
   * respectively.
   *
   * @default DefaultStackSynthesizer.DEFAULT_FILE_ASSET_KEY_ARN_EXPORT_NAME
   * @deprecated This property is not used anymore
   */
  readonly fileAssetKeyArnExportName?: string;

  /**
   * Qualifier to disambiguate multiple environments in the same account
   *
   * You can use this and leave the other naming properties empty if you have deployed
   * the bootstrap environment with standard names but only differnet qualifiers.
   *
   * @default - Value of context key '@aws-cdk/core:bootstrapQualifier' if set, otherwise `DefaultStackSynthesizer.DEFAULT_QUALIFIER`
   */
  readonly qualifier?: string;

  /**
   * Whether to add a Rule to the stack template verifying the bootstrap stack version
   *
   * This generally should be left set to `true`, unless you explicitly
   * want to be able to deploy to an unbootstrapped environment.
   *
   * @default true
   */
  readonly generateBootstrapVersionRule?: boolean;

  /**
   * bucketPrefix to use while storing S3 Assets
   *
   * @default - DefaultStackSynthesizer.DEFAULT_FILE_ASSET_PREFIX
   */
  readonly bucketPrefix?: string;

  /**
   * A prefix to use while tagging and uploading Docker images to ECR.
   *
   * This does not add any separators - the source hash will be appended to
   * this string directly.
   *
   * @default - DefaultStackSynthesizer.DEFAULT_DOCKER_ASSET_PREFIX
   */
  readonly dockerTagPrefix?: string;

  /**
   * Bootstrap stack version SSM parameter.
   *
   * The placeholder `${Qualifier}` will be replaced with the value of qualifier.
   *
   * @default DefaultStackSynthesizer.DEFAULT_BOOTSTRAP_STACK_VERSION_SSM_PARAMETER
   */
  readonly bootstrapStackVersionSsmParameter?: string;
}

/**
 * Uses conventionally named roles and asset storage locations
 *
 * This synthesizer:
 *
 * - Supports cross-account deployments (the CLI can have credentials to one
 *   account, and you can still deploy to another account by assuming roles with
 *   well-known names in the other account).
 * - Supports the **CDK Pipelines** library.
 *
 * Requires the environment to have been bootstrapped with Bootstrap Stack V2
 * (also known as "modern bootstrap stack"). The synthesizer adds a version
 * check to the template, to make sure the bootstrap stack is recent enough
 * to support all features expected by this synthesizer.
 */
export class DefaultStackSynthesizer extends StackSynthesizer {
  /**
   * Default ARN qualifier
   */
  public static readonly DEFAULT_QUALIFIER = 'hnb659fds';

  /**
   * Default CloudFormation role ARN.
   */
  public static readonly DEFAULT_CLOUDFORMATION_ROLE_ARN = 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/cdk-${Qualifier}-cfn-exec-role-${AWS::AccountId}-${AWS::Region}';

  /**
   * Default deploy role ARN.
   */
  public static readonly DEFAULT_DEPLOY_ROLE_ARN = 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/cdk-${Qualifier}-deploy-role-${AWS::AccountId}-${AWS::Region}';

  /**
   * Default asset publishing role ARN for file (S3) assets.
   */
  public static readonly DEFAULT_FILE_ASSET_PUBLISHING_ROLE_ARN = 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/cdk-${Qualifier}-file-publishing-role-${AWS::AccountId}-${AWS::Region}';

  /**
   * Default asset publishing role ARN for image (ECR) assets.
   */
  public static readonly DEFAULT_IMAGE_ASSET_PUBLISHING_ROLE_ARN = 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/cdk-${Qualifier}-image-publishing-role-${AWS::AccountId}-${AWS::Region}';

  /**
   * Default lookup role ARN for missing values.
   */
  public static readonly DEFAULT_LOOKUP_ROLE_ARN = 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/cdk-${Qualifier}-lookup-role-${AWS::AccountId}-${AWS::Region}';

  /**
   * Default image assets repository name
   */
  public static readonly DEFAULT_IMAGE_ASSETS_REPOSITORY_NAME = 'cdk-${Qualifier}-container-assets-${AWS::AccountId}-${AWS::Region}';

  /**
   * Default file assets bucket name
   */
  public static readonly DEFAULT_FILE_ASSETS_BUCKET_NAME = 'cdk-${Qualifier}-assets-${AWS::AccountId}-${AWS::Region}';

  /**
   * Name of the CloudFormation Export with the asset key name
   */
  public static readonly DEFAULT_FILE_ASSET_KEY_ARN_EXPORT_NAME = 'CdkBootstrap-${Qualifier}-FileAssetKeyArn';

  /**
   * Default file asset prefix
   */
  public static readonly DEFAULT_FILE_ASSET_PREFIX = '';
  /**
   * Default Docker asset prefix
   */
  public static readonly DEFAULT_DOCKER_ASSET_PREFIX = '';

  /**
   * Default bootstrap stack version SSM parameter.
   */
  public static readonly DEFAULT_BOOTSTRAP_STACK_VERSION_SSM_PARAMETER = '/cdk-bootstrap/${Qualifier}/version';

  private _stack?: Stack;
  private bucketName?: string;
  private repositoryName?: string;
  private _deployRoleArn?: string;
  private _cloudFormationExecutionRoleArn?: string;
  private fileAssetPublishingRoleArn?: string;
  private imageAssetPublishingRoleArn?: string;
  private lookupRoleArn?: string;
  private useLookupRoleForStackOperations: boolean;
  private qualifier?: string;
  private bucketPrefix?: string;
  private dockerTagPrefix?: string;
  private bootstrapStackVersionSsmParameter?: string;

  private assetManifest = new AssetManifestBuilder();

  constructor(private readonly props: DefaultStackSynthesizerProps = {}) {
    super();
    this.useLookupRoleForStackOperations = props.useLookupRoleForStackOperations ?? true;

    for (const key in props) {
      if (props.hasOwnProperty(key)) {
        validateNoToken(key as keyof DefaultStackSynthesizerProps);
      }
    }

    function validateNoToken<A extends keyof DefaultStackSynthesizerProps>(key: A) {
      const prop = props[key];
      if (typeof prop === 'string' && Token.isUnresolved(prop)) {
        throw new Error(`DefaultSynthesizer property '${key}' cannot contain tokens; only the following placeholder strings are allowed: ` + [
          '${Qualifier}',
          cxapi.EnvironmentPlaceholders.CURRENT_REGION,
          cxapi.EnvironmentPlaceholders.CURRENT_ACCOUNT,
          cxapi.EnvironmentPlaceholders.CURRENT_PARTITION,
        ].join(', '));
      }
    }
  }

  public bind(stack: Stack): void {
    if (this._stack !== undefined) {
      throw new Error('A StackSynthesizer can only be used for one Stack: create a new instance to use with a different Stack');
    }

    this._stack = stack;

    const qualifier = this.props.qualifier ?? stack.node.tryGetContext(BOOTSTRAP_QUALIFIER_CONTEXT) ?? DefaultStackSynthesizer.DEFAULT_QUALIFIER;
    this.qualifier = qualifier;

    const spec = new StringSpecializer(stack, qualifier);

    /* eslint-disable max-len */
    this.bucketName = spec.specialize(this.props.fileAssetsBucketName ?? DefaultStackSynthesizer.DEFAULT_FILE_ASSETS_BUCKET_NAME);
    this.repositoryName = spec.specialize(this.props.imageAssetsRepositoryName ?? DefaultStackSynthesizer.DEFAULT_IMAGE_ASSETS_REPOSITORY_NAME);
    this._deployRoleArn = spec.specialize(this.props.deployRoleArn ?? DefaultStackSynthesizer.DEFAULT_DEPLOY_ROLE_ARN);
    this._cloudFormationExecutionRoleArn = spec.specialize(this.props.cloudFormationExecutionRole ?? DefaultStackSynthesizer.DEFAULT_CLOUDFORMATION_ROLE_ARN);
    this.fileAssetPublishingRoleArn = spec.specialize(this.props.fileAssetPublishingRoleArn ?? DefaultStackSynthesizer.DEFAULT_FILE_ASSET_PUBLISHING_ROLE_ARN);
    this.imageAssetPublishingRoleArn = spec.specialize(this.props.imageAssetPublishingRoleArn ?? DefaultStackSynthesizer.DEFAULT_IMAGE_ASSET_PUBLISHING_ROLE_ARN);
    this.lookupRoleArn = spec.specialize(this.props.lookupRoleArn ?? DefaultStackSynthesizer.DEFAULT_LOOKUP_ROLE_ARN);
    this.bucketPrefix = spec.specialize(this.props.bucketPrefix ?? DefaultStackSynthesizer.DEFAULT_FILE_ASSET_PREFIX);
    this.dockerTagPrefix = spec.specialize(this.props.dockerTagPrefix ?? DefaultStackSynthesizer.DEFAULT_DOCKER_ASSET_PREFIX);
    this.bootstrapStackVersionSsmParameter = spec.qualifierOnly(this.props.bootstrapStackVersionSsmParameter ?? DefaultStackSynthesizer.DEFAULT_BOOTSTRAP_STACK_VERSION_SSM_PARAMETER);
    /* eslint-enable max-len */
  }

  public addFileAsset(asset: FileAssetSource): FileAssetLocation {
    assertBound(this.stack);
    assertBound(this.bucketName);
    assertBound(this.bucketPrefix);

    return this.assetManifest.addFileAssetDefault(asset, this.stack, this.bucketName, this.bucketPrefix, {
      assumeRoleArn: this.fileAssetPublishingRoleArn,
      assumeRoleExternalId: this.props.fileAssetPublishingExternalId,
    });
  }

  public addDockerImageAsset(asset: DockerImageAssetSource): DockerImageAssetLocation {
    assertBound(this.stack);
    assertBound(this.repositoryName);
    assertBound(this.dockerTagPrefix);

    return this.assetManifest.addDockerImageAssetDefault(asset, this.stack, this.repositoryName, this.dockerTagPrefix, {
      assumeRoleArn: this.imageAssetPublishingRoleArn,
      assumeRoleExternalId: this.props.imageAssetPublishingExternalId,
    });
  }

  protected synthesizeStackTemplate(stack: Stack, session: ISynthesisSession) {
    stack._synthesizeTemplate(session, this.lookupRoleArn);
  }

  /**
   * Synthesize the associated stack to the session
   */
  public synthesize(session: ISynthesisSession): void {
    assertBound(this.stack);
    assertBound(this.qualifier);

    // Must be done here -- if it's done in bind() (called in the Stack's constructor)
    // then it will become impossible to set context after that.
    //
    // If it's done AFTER _synthesizeTemplate(), then the template won't contain the
    // right constructs.
    if (this.props.generateBootstrapVersionRule ?? true) {
      addBootstrapVersionRule(this.stack, MIN_BOOTSTRAP_STACK_VERSION, <string> this.bootstrapStackVersionSsmParameter);
    }

    this.synthesizeStackTemplate(this.stack, session);

    const templateAsset = this.addFileAsset(stackTemplateFileAsset(this.stack, session));

    const assetManifestId = this.assetManifest.writeManifest(this.stack, session, {
      requiresBootstrapStackVersion: MIN_BOOTSTRAP_STACK_VERSION,
      bootstrapStackVersionSsmParameter: this.bootstrapStackVersionSsmParameter,
    });

    this.emitStackArtifact(this.stack, session, {
      assumeRoleExternalId: this.props.deployRoleExternalId,
      assumeRoleArn: this._deployRoleArn,
      cloudFormationExecutionRoleArn: this._cloudFormationExecutionRoleArn,
      stackTemplateAssetObjectUrl: templateAsset.s3ObjectUrlWithPlaceholders,
      requiresBootstrapStackVersion: MIN_BOOTSTRAP_STACK_VERSION,
      bootstrapStackVersionSsmParameter: this.bootstrapStackVersionSsmParameter,
      additionalDependencies: [assetManifestId],
      lookupRole: this.useLookupRoleForStackOperations && this.lookupRoleArn ? {
        arn: this.lookupRoleArn,
        assumeRoleExternalId: this.props.lookupRoleExternalId,
        requiresBootstrapStackVersion: MIN_LOOKUP_ROLE_BOOTSTRAP_STACK_VERSION,
        bootstrapStackVersionSsmParameter: this.bootstrapStackVersionSsmParameter,
      } : undefined,
    });
  }

  /**
   * Returns the ARN of the deploy Role.
   */
  public get deployRoleArn(): string {
    if (!this._deployRoleArn) {
      throw new Error('deployRoleArn getter can only be called after the synthesizer has been bound to a Stack');
    }
    return this._deployRoleArn;
  }

  /**
   * Returns the ARN of the CFN execution Role.
   */
  public get cloudFormationExecutionRoleArn(): string {
    if (!this._cloudFormationExecutionRoleArn) {
      throw new Error('cloudFormationExecutionRoleArn getter can only be called after the synthesizer has been bound to a Stack');
    }
    return this._cloudFormationExecutionRoleArn;
  }

  protected get stack(): Stack | undefined {
    return this._stack;
  }
}

/**
 * Add a CfnRule to the Stack which checks the current version of the bootstrap stack this template is targeting
 *
 * The CLI normally checks this, but in a pipeline the CLI is not involved
 * so we encode this rule into the template in a way that CloudFormation will check it.
 */
function addBootstrapVersionRule(stack: Stack, requiredVersion: number, bootstrapStackVersionSsmParameter: string) {
  // Because of https://github.com/aws/aws-cdk/blob/master/packages/assert-internal/lib/synth-utils.ts#L74
  // synthesize() may be called more than once on a stack in unit tests, and the below would break
  // if we execute it a second time. Guard against the constructs already existing.
  if (stack.node.tryFindChild('BootstrapVersion')) { return; }

  const param = new CfnParameter(stack, 'BootstrapVersion', {
    type: 'AWS::SSM::Parameter::Value<String>',
    description: `Version of the CDK Bootstrap resources in this environment, automatically retrieved from SSM Parameter Store. ${cxapi.SSMPARAM_NO_INVALIDATE}`,
    default: bootstrapStackVersionSsmParameter,
  });

  // There is no >= check in CloudFormation, so we have to check the number
  // is NOT in [1, 2, 3, ... <required> - 1]
  const oldVersions = range(1, requiredVersion).map(n => `${n}`);

  new CfnRule(stack, 'CheckBootstrapVersion', {
    assertions: [
      {
        assert: Fn.conditionNot(Fn.conditionContains(oldVersions, param.valueAsString)),
        assertDescription: `CDK bootstrap stack version ${requiredVersion} required. Please run 'cdk bootstrap' with a recent version of the CDK CLI.`,
      },
    ],
  });
}

function range(startIncl: number, endExcl: number) {
  const ret = new Array<number>();
  for (let i = startIncl; i < endExcl; i++) {
    ret.push(i);
  }
  return ret;
}
